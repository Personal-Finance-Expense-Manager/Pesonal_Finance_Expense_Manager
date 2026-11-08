import FinancialOperation from '../models/FinancialOperation.js';
import RecurringOccurrence from '../models/RecurringOccurrence.js';
import RecurringRule from '../models/RecurringRule.js';
import Notification from '../models/Notification.js';
import Transaction from '../models/Transaction.js';
import { ApiError } from '../utils/apiError.js';
import { formatDateOnly } from '../utils/period.js';
import { dueCutoff, occurrenceDate, withinLimits } from '../utils/recurrence.js';
import { createTransactionRecord } from './transactionService.js';

/**
 * Automatic generation of recurring transactions - US-16 (#43), REQ-54, REQ-60.
 *
 * How it stays correct however often, and wherever, it runs:
 *
 *  1. An occurrence is "claimed" by inserting a row in RecurringOccurrence,
 *     which has a unique index on (rule, scheduled date). Only one caller can
 *     claim a given occurrence, so there is never a second transaction.
 *  2. The Transaction also carries a unique index on (rule, scheduled date),
 *     so even a claim that was lost half-way cannot produce a duplicate.
 *  3. The rule is advanced with a guarded update ("only if next_due_date is
 *     still the one I processed"), so a second process cannot advance it twice.
 *  4. A claim whose process died (no transaction after STALE_CLAIM_MS) is
 *     completed by the next run.
 *
 * The scheduler is a catch-up loop, not a timer per rule: each run processes
 * every occurrence due up to the cutoff, each dated with its ORIGINAL due date
 * (REQ-60). A restart, a missed night or a repeated run changes nothing but
 * the work that is still outstanding.
 */

export const STALE_CLAIM_MS = 5 * 60 * 1000;
const MAX_OCCURRENCES_PER_RULE_PER_RUN = 500;
const RULE_CONCURRENCY = 10;

const isDuplicateKey = (error) => error?.code === 11000;
const day = (date) => formatDateOnly(date);

function transactionData(rule, scheduled, { withCategory = true } = {}) {
  return {
    type: rule.type,
    amount: rule.amount.toString(),
    account_id: String(rule.account_id),
    category_id: withCategory && rule.category_id ? String(rule.category_id) : null,
    payment_mode: rule.payment_mode,
    note: rule.note || '',
    transaction_date: scheduled,
    tags: [],
    splits: [],
  };
}

/** Create the transaction for a claimed occurrence, or recover the one that exists. */
async function createFor(rule, scheduled) {
  const link = {
    is_system_generated: true,
    recurring_rule_id: rule._id,
    recurring_scheduled_date: scheduled,
  };

  try {
    try {
      return { transaction: (await createTransactionRecord(rule.user_id, transactionData(rule, scheduled), link)).transaction };
    } catch (error) {
      // The category was deleted since the rule was made: keep the money
      // flowing, uncategorised, rather than dropping the occurrence.
      if (error instanceof ApiError && error.status === 400 && rule.category_id) {
        return { transaction: (await createTransactionRecord(rule.user_id, transactionData(rule, scheduled, { withCategory: false }), link)).transaction };
      }
      throw error;
    }
  } catch (error) {
    if (isDuplicateKey(error)) {
      // A previous attempt got as far as the transaction. Adopt it.
      const existing = await Transaction.findOne({
        recurring_rule_id: rule._id,
        recurring_scheduled_date: scheduled,
      });
      if (existing) return { transaction: existing };
    }
    if (error instanceof ApiError && error.status === 404) {
      return { skipped: 'The account is archived or no longer available.' };
    }
    throw error;
  }
}

/**
 * Turn a claimed ledger row into a generated (or skipped) occurrence.
 * Idempotent: running it again on a finished row does nothing.
 */
async function finishOccurrence(rule, ledger) {
  const scheduled = ledger.scheduled_date;
  const outcome = await createFor(rule, scheduled);

  if (outcome.skipped) {
    await RecurringOccurrence.updateOne(
      { _id: ledger._id, status: 'claimed' },
      { $set: { status: 'skipped', skip_reason: outcome.skipped } },
    );
    await Notification.create({
      user_id: rule.user_id,
      type: 'recurring_skipped',
      title: 'A recurring transaction was skipped',
      body: `The ${rule.frequency} ${rule.type} due on ${day(scheduled)} could not be created: ${outcome.skipped}`,
    }).catch(() => {});
    return 'skipped';
  }

  await RecurringOccurrence.updateOne(
    { _id: ledger._id, status: 'claimed' },
    { $set: { status: 'generated', transaction_id: outcome.transaction._id } },
  );
  return 'generated';
}

/**
 * Process every due occurrence of one rule, oldest first.
 * Returns counts; never throws for a duplicate.
 */
export async function processRule(ruleId, cutoff, { now = new Date() } = {}) {
  const counts = { generated: 0, skipped: 0, duplicates: 0 };

  for (let i = 0; i < MAX_OCCURRENCES_PER_RULE_PER_RUN; i += 1) {
    // Re-read every time: the rule may have been paused, edited or advanced.
    const rule = await RecurringRule.findOne({ _id: ruleId, status: 'active' });
    if (!rule || rule.next_due_date.getTime() > cutoff.getTime()) break;

    if (await FinancialOperation.exists({ user_id: rule.user_id })) break;
    const scheduled = rule.next_due_date;

    // The rule has run out (end date or count reached): close it.
    if (!withinLimits({
      date: scheduled,
      endDate: rule.end_date,
      occurrenceCount: rule.occurrence_count,
      occurrencesDone: rule.occurrences_done,
    })) {
      await RecurringRule.updateOne(
        { _id: rule._id, status: 'active' },
        { $set: { status: 'completed' } },
      );
      break;
    }

    let ledger;
    let outcome;

    try {
      ledger = await RecurringOccurrence.create({
        rule_id: rule._id,
        user_id: rule.user_id,
        scheduled_date: scheduled,
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      ledger = await RecurringOccurrence.findOne({ rule_id: rule._id, scheduled_date: scheduled });
      counts.duplicates += 1;

      if (ledger?.status === 'claimed') {
        // Someone else is mid-way. Leave it unless that claim has gone stale.
        if (now.getTime() - ledger.updatedAt.getTime() < STALE_CLAIM_MS) break;
        outcome = await finishOccurrence(rule, ledger);
      } else {
        // Already generated or skipped by an earlier run: just move on.
        outcome = 'duplicate';
      }
    }

    if (!outcome) {
      try {
        outcome = ledger.status === 'claimed' ? await finishOccurrence(rule, ledger) : ledger.status;
      } catch (error) {
        // Release the claim so the next run retries instead of waiting for it to go stale.
        await RecurringOccurrence.deleteOne({ _id: ledger._id, status: 'claimed', transaction_id: null });
        throw error;
      }
    }

    if (outcome === 'generated') counts.generated += 1;
    if (outcome === 'skipped') counts.skipped += 1;

    // Advance to the next occurrence, but only if nobody else already has.
    const nextIndex = rule.next_index + 1;
    const nextDate = occurrenceDate(rule.anchor_date, rule.frequency, nextIndex);
    const done = rule.occurrences_done + 1;
    const finished = !withinLimits({
      date: nextDate,
      endDate: rule.end_date,
      occurrenceCount: rule.occurrence_count,
      occurrencesDone: done,
    });

    const $set = { next_index: nextIndex, next_due_date: nextDate, occurrences_done: done };
    if (outcome === 'generated') $set.last_generated_date = scheduled;
    if (finished) $set.status = 'completed';

    await RecurringRule.updateOne(
      { _id: rule._id, status: 'active', next_due_date: scheduled },
      { $set },
    );
  }

  return counts;
}

/** Finish claims whose process died, whatever state their rule is in now. */
export async function completeStaleClaims({ now = new Date() } = {}) {
  const stale = await RecurringOccurrence.find({
    status: 'claimed',
    updatedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) },
  }).limit(200);

  let completed = 0;
  for (const ledger of stale) {
    const rule = await RecurringRule.findById(ledger.rule_id);
    if (!rule) {
      await RecurringOccurrence.deleteOne({ _id: ledger._id, status: 'claimed' });
      continue;
    }
    if (await FinancialOperation.exists({ user_id: rule.user_id })) continue;
    try {
      await finishOccurrence(rule, ledger);
      completed += 1;
    } catch (error) {
      console.error(`[recurring] could not complete stale claim ${ledger._id}:`, error.message);
    }
  }
  return completed;
}

/**
 * One scheduler pass. Safe to call at any time and any number of times:
 * it generates exactly the occurrences that are due and not yet generated.
 */
export async function processDueRules({ now = new Date() } = {}) {
  const cutoff = dueCutoff(now);
  const summary = { rules: 0, generated: 0, skipped: 0, duplicates: 0, failed: 0, recovered: 0 };

  summary.recovered = await completeStaleClaims({ now });

  const due = await RecurringRule.find({
    status: 'active',
    next_due_date: { $lte: cutoff },
  }).select('_id').lean();

  for (let i = 0; i < due.length; i += RULE_CONCURRENCY) {
    const batch = due.slice(i, i + RULE_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((r) => processRule(r._id, cutoff, { now })));

    for (const [n, result] of results.entries()) {
      summary.rules += 1;
      if (result.status === 'fulfilled') {
        summary.generated += result.value.generated;
        summary.skipped += result.value.skipped;
        summary.duplicates += result.value.duplicates;
      } else {
        summary.failed += 1;
        console.error(`[recurring] rule ${batch[n]._id} failed:`, result.reason?.message);
      }
    }
  }

  return summary;
}
