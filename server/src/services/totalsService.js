import Decimal from 'decimal.js';
import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Tag from '../models/Tag.js';
import Transaction from '../models/Transaction.js';
import TransactionTag from '../models/TransactionTag.js';

/**
 * Category-wise and tag-wise totals - US-13 (#31), SRS 5.4: REQ-42.
 *
 * Counting rules follow the dashboard (US-20) so the two never disagree:
 *   - deleted transactions are left out
 *   - transfers between own accounts are not income or expense (BR-2), and
 *     live in their own collection, so they are never counted here
 *   - transactions excluded from budgets still count: that flag only affects
 *     budget utilisation (REQ-33, REQ-50)
 *   - the base-currency amount is used where one was stored (BR-13)
 *
 * REQ-42 also requires the figures to be no more than five seconds stale.
 * Nothing is cached - every request recomputes from the transactions - so a
 * total can never lag behind an add, edit or delete.
 */

const ZERO = new Decimal(0);
const amountField = { $ifNull: ['$converted_amount', '$amount'] };

/**
 * Turn aggregated {_id, total, count} rows into a sorted, presented list with
 * each row's share of the whole. Pure, so it is unit tested directly.
 */
export function shareOf(rows, names, grandTotal, fallbackName = 'Uncategorised') {
  const total = new Decimal(grandTotal);

  return rows
    .map((row) => ({
      id: row._id ? row._id.toString() : null,
      name: row._id ? (names.get(row._id.toString()) ?? 'Deleted') : fallbackName,
      amount: new Decimal(row.total.toString()),
      transaction_count: row.count,
    }))
    .sort((a, b) => b.amount.comparedTo(a.amount))
    .map((row) => ({
      ...row,
      amount: row.amount.toFixed(2),
      share_percent: total.isZero()
        ? 0
        : Number(row.amount.dividedBy(total).times(100).toDecimalPlaces(1).toString()),
    }));
}

/** Sum a list of presented rows. Pure; used for the tag subtotal. */
export function sumAmounts(rows) {
  return rows
    .reduce((acc, row) => acc.plus(new Decimal(row.amount)), ZERO)
    .toFixed(2);
}

/**
 * Category-wise and tag-wise totals for one user over a date range.
 *
 * `type` is 'expense' or 'income'. Dates are inclusive date-only values.
 */
export async function totalsForPeriod(userId, { from, to, type = 'expense' }) {
  const uid = new mongoose.Types.ObjectId(userId);

  const match = {
    user_id: uid,
    type,
    is_deleted: { $ne: true },
    transaction_date: { $gte: from, $lte: to },
  };

  // ---- by category ------------------------------------------------------
  const categoryRows = await Transaction.aggregate([
    { $match: match },
    { $group: { _id: '$category_id', total: { $sum: amountField }, count: { $sum: 1 } } },
  ]);

  const grandTotal = categoryRows
    .reduce((acc, row) => acc.plus(new Decimal(row.total.toString())), ZERO)
    .toFixed(2);

  const categories = await Category.find({
    _id: { $in: categoryRows.map((r) => r._id).filter(Boolean) },
  }).select('name').lean();

  const categoryNames = new Map(categories.map((c) => [c._id.toString(), c.name]));

  // ---- by tag -----------------------------------------------------------
  // A transaction may carry several tags, so one transaction can contribute to
  // more than one tag total. Tag totals therefore do not have to add up to the
  // grand total, and the response says so explicitly.
  const matching = await Transaction.find(match).select('_id').lean();
  const transactionIds = matching.map((t) => t._id);

  let tags = [];
  let untaggedCount = 0;

  if (transactionIds.length > 0) {
    const links = await TransactionTag.find({
      transaction_id: { $in: transactionIds },
    }).lean();

    const taggedIds = new Set(links.map((l) => l.transaction_id.toString()));
    untaggedCount = transactionIds.length - taggedIds.size;

    if (links.length > 0) {
      const amounts = await Transaction.aggregate([
        { $match: { _id: { $in: links.map((l) => l.transaction_id) } } },
        { $project: { amount: amountField } },
      ]);

      const amountById = new Map(amounts.map((a) => [a._id.toString(), a.amount]));

      const perTag = new Map();
      for (const link of links) {
        const key = link.tag_id.toString();
        const amount = amountById.get(link.transaction_id.toString());
        if (amount === undefined) continue;

        const entry = perTag.get(key) || { _id: link.tag_id, total: ZERO, count: 0 };
        entry.total = entry.total.plus(new Decimal(amount.toString()));
        entry.count += 1;
        perTag.set(key, entry);
      }

      const tagDocs = await Tag.find({ _id: { $in: [...perTag.values()].map((t) => t._id) } })
        .select('name').lean();

      const tagNames = new Map(tagDocs.map((t) => [t._id.toString(), t.name]));

      tags = shareOf(
        [...perTag.values()].map((t) => ({ _id: t._id, total: t.total.toString(), count: t.count })),
        tagNames,
        grandTotal,
        'Untagged'
      );
    }
  }

  return {
    type,
    from,
    to,
    grand_total: grandTotal,
    transaction_count: transactionIds.length,
    by_category: shareOf(categoryRows, categoryNames, grandTotal),
    by_tag: tags,
    untagged_transaction_count: untaggedCount,
    tagged_total: sumAmounts(tags),
    note:
      'A transaction can carry several tags, so tag totals may add up to more than the grand total.',
  };
}
