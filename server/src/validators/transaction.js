
import Decimal from 'decimal.js';
import { parseDateOnly, today } from '../utils/period.js';

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer'];
export const MAX_NOTE_LENGTH = 200;
export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 20;
export const MAX_SPLITS = 5;

const AMOUNT_ERROR =
  'Enter an amount greater than 0 with up to 2 decimal places.';

const ALLOWED_FIELDS = [
  'type',
  'amount',
  'transaction_date',
  'account_id',
  'from_account_id',
  'to_account_id',
  'category_id',
  'payment_mode',
  'note',
  'tags',
  'is_excluded_from_budget',
  'splits',
];

const PAYMENT_MODES = [
  'cash',
  'card',
  'upi',
  'bank_transfer',
  'wallet',
  'other',
];

function isObjectId(value) {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
}

/**
 * A money value as a two-decimal string, or null if it is not one.
 *
 * Shared by the transaction amount and by every split part (REQ-32), so a
 * split is held to exactly the same rule as the total it must add up to.
 */
function parseAmount(raw) {
  const value =
    typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';

  if (!/^\d+(\.\d+)?$/.test(value)) return null;

  const amount = new Decimal(value);

  const valid =
    amount.isFinite() &&
    amount.greaterThan(0) &&
    amount.decimalPlaces() <= 2 &&
    amount.lessThanOrEqualTo('999999999999.99');

  return valid ? amount.toFixed(2) : null;
}

function latestAllowedDate() {
  const current = today();
  if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
    return null;
  }

  const latest = new Date(current);
  latest.setUTCDate(latest.getUTCDate() + 1);
  return latest;
}

/**
 * Validate a transaction request body.
 *
 * allowPartial  - edit mode (US-09): only the fields sent are checked.
 * currentType   - edit mode: the type already stored. A partial body that does
 *                 not repeat `type` is validated against it, so a bare
 *                 { account_id } or { tags } is checked rather than ignored.
 */
export function validateTransactionInput(
  body,
  { allowPartial = false, currentType } = {},
) {
  const input =
    body && typeof body === 'object' && !Array.isArray(body)
      ? body
      : {};

  const errors = {};
  const data = {};

  for (const key of Object.keys(input)) {
    if (!ALLOWED_FIELDS.includes(key)) {
      errors[key] = 'This field cannot be changed.';
    }
  }

  const required = (key) => !allowPartial || key in input;

  if (required('type')) {
    if (!TRANSACTION_TYPES.includes(input.type)) {
      errors.type = 'Type must be income, expense, or transfer.';
    } else {
      data.type = input.type;
    }
  }

  if (required('amount')) {
    const amount = parseAmount(input.amount);

    if (amount === null) {
      errors.amount = AMOUNT_ERROR;
    } else {
      data.amount = amount;
    }
  }

  if (required('transaction_date')) {
    const date = parseDateOnly(input.transaction_date);
    const latest = latestAllowedDate();

    if (!date) {
      errors.transaction_date =
        'Enter a valid date in YYYY-MM-DD format.';
    } else if (!latest || date > latest) {
      errors.transaction_date =
        'Transaction date cannot be more than one day in the future.';
    } else {
      data.transaction_date = date;
    }
  }

  const kind = data.type ?? currentType;

  if (kind === 'transfer') {
    for (const key of ['from_account_id', 'to_account_id']) {
      if (required(key)) {
        if (!isObjectId(input[key])) {
          errors[key] = 'Select a valid account.';
        } else {
          data[key] = input[key];
        }
      }
    }

    if (
      data.from_account_id &&
      data.to_account_id &&
      data.from_account_id === data.to_account_id
    ) {
      errors.to_account_id =
        'Source and destination accounts must be different.';
    }

    if ('account_id' in input) {
      errors.account_id =
        'Transfers must use source and destination accounts.';
    }

    if (allowPartial) {
      for (const key of ['category_id', 'payment_mode', 'tags']) {
        if (key in input) {
          errors[key] = 'A transfer has no category, payment mode or tags.';
        }
      }
    }
  } else if (kind === 'income' || kind === 'expense') {
    if (allowPartial) {
      for (const key of ['from_account_id', 'to_account_id']) {
        if (key in input) {
          errors[key] =
            'Only a transfer has source and destination accounts.';
        }
      }
    }

    if (required('account_id')) {
      if (!isObjectId(input.account_id)) {
        errors.account_id = 'Select a valid account.';
      } else {
        data.account_id = input.account_id;
      }
    }

    if (required('category_id')) {
      const categoryId = input.category_id;

      if (
        categoryId === undefined ||
        categoryId === null ||
        categoryId === ''
      ) {
        data.category_id = null;
      } else if (!isObjectId(categoryId)) {
        errors.category_id = 'Select a valid category.';
      } else {
        data.category_id = categoryId;
      }
    }

    // REQ-32: a split bill, across at most five categories, whose parts must
    // sum to the transaction amount exactly. Checked against the amount in
    // this same body, so a split can never be stored against a different
    // total than the one it was validated for.
    if (required('splits')) {
      const splits = input.splits;

      if (splits !== undefined && splits !== null && !Array.isArray(splits)) {
        errors.splits = 'Splits must be a list.';
      } else if (Array.isArray(splits) && splits.length > 0) {
        if (kind !== 'expense') {
          errors.splits = 'Only an expense can be split across categories.';
        } else if (splits.length > MAX_SPLITS) {
          errors.splits = `An expense can be split across at most ${MAX_SPLITS} categories.`;
        } else if (splits.length < 2) {
          errors.splits = 'A split needs at least two categories.';
        } else {
          const parts = [];
          let bad = null;

          for (const split of splits) {
            if (!split || typeof split !== 'object') {
              bad = 'Each split needs a category and an amount.';
              break;
            }

            const categoryId = split.category_id;

            if (
              categoryId !== null &&
              categoryId !== undefined &&
              categoryId !== '' &&
              !isObjectId(categoryId)
            ) {
              bad = 'Select a valid category for every split.';
              break;
            }

            const partAmount = parseAmount(split.amount);

            if (!partAmount) {
              bad = 'Enter an amount greater than 0 with up to 2 decimal places for every split.';
              break;
            }

            parts.push({
              category_id: categoryId === '' || categoryId === undefined ? null : categoryId,
              amount: partAmount,
            });
          }

          if (bad) {
            errors.splits = bad;
          } else if (data.amount === undefined) {
            // An edit that changes the splits must send the amount too, so the
            // two can be checked against each other rather than against a
            // total that may be about to change.
            errors.splits = 'Send the transaction amount with its splits.';
          } else {
            const sum = parts.reduce((acc, part) => acc.plus(new Decimal(part.amount)), new Decimal(0));

            if (!sum.equals(new Decimal(data.amount))) {
              errors.splits =
                `The split amounts add up to ${sum.toFixed(2)}, but the transaction is ${new Decimal(data.amount).toFixed(2)}.`;
            } else {
              data.splits = parts;
              // The parts carry the category attribution; keeping a parent
              // category as well would be a second, disagreeing answer.
              data.category_id = null;
            }
          }
        }
      } else if (splits !== undefined) {
        data.splits = [];
      }
    }

    // REQ-33: a reimbursable or one-off item can be kept out of budgets while
    // still counting towards balances and reports.
    if (required('is_excluded_from_budget')) {
      const flag = input.is_excluded_from_budget;

      if (flag !== undefined && typeof flag !== 'boolean') {
        errors.is_excluded_from_budget = 'Excluded from budgets must be true or false.';
      } else if (flag !== undefined) {
        data.is_excluded_from_budget = flag;
      }
    }

    if (required('payment_mode')) {
      if (
        input.payment_mode !== undefined &&
        !PAYMENT_MODES.includes(input.payment_mode)
      ) {
        errors.payment_mode = 'Select a valid payment mode.';
      } else {
        data.payment_mode = input.payment_mode || 'other';
      }
    }

    if (required('tags')) {
      if (input.tags !== undefined && !Array.isArray(input.tags)) {
        errors.tags = 'Tags must be a list.';
      } else {
        const tags = (input.tags || []).map((tag) =>
          typeof tag === 'string' ? tag.trim() : tag,
        );

        if (tags.length > MAX_TAGS) {
          errors.tags = `You can add up to ${MAX_TAGS} tags per transaction.`;
        } else if (
          tags.some(
            (tag) =>
              typeof tag !== 'string' ||
              tag.length < 1 ||
              tag.length > MAX_TAG_LENGTH,
          )
        ) {
          errors.tags =
            `Each tag must contain 1 to ${MAX_TAG_LENGTH} characters.`;
        } else {
          // Tags are matched case-insensitively, so "Food" and "food" are one
          // tag. Keep the first spelling; two links to the same tag would
          // break the unique (transaction, tag) index and fail the request.
          const seen = new Set();
          data.tags = tags.filter((tag) => {
            const key = tag.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
      }
    }
  }

  if (required('note')) {
    if (input.note !== undefined && typeof input.note !== 'string') {
      errors.note = 'Note must be text.';
    } else {
      const note = (input.note || '').trim();

      if (note.length > MAX_NOTE_LENGTH) {
        errors.note =
          `Note must be ${MAX_NOTE_LENGTH} characters or fewer.`;
      } else {
        data.note = note;
      }
    }
  }

  if (
    !Object.keys(errors).length &&
    allowPartial &&
    !Object.keys(data).length
  ) {
    errors.body = 'Provide at least one field to update.';
  }

  return Object.keys(errors).length ? { errors } : { data };
}
