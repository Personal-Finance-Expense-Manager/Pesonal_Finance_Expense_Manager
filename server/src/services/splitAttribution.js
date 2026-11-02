/**
 * Attributing a split bill to its categories - US-11 (#27), SRS 5.3: REQ-32.
 *
 * An ordinary transaction belongs to one category. A split one is spread over
 * up to five, and the parts must sum exactly to the amount. Every screen that
 * answers "how much went to this category?" has to honour that, or a split
 * bill would read differently on the dashboard, the totals, the charts, the
 * report and the budgets.
 *
 * Rather than repeat the logic in five aggregations, they all use the stages
 * below. A transaction with no splits yields exactly one part - itself - so
 * the expansion changes nothing for records that are not split.
 */

/** The stored amount, in base currency where one was converted (BR-13). */
const AMOUNT = { $ifNull: ['$converted_amount', '$amount'] };

/**
 * Stages that turn each transaction into one row per category it touches.
 *
 * After these, every document has:
 *   part_category_id  the category this row is attributed to
 *   part_amount       the money attributed to it
 *
 * A split transaction becomes several rows, so grouping by `part_category_id`
 * and summing `part_amount` gives the right figure per category, and the
 * overall sum is unchanged because the parts sum to the whole.
 */
export function splitExpansionStages() {
  return [
    {
      $addFields: {
        _parts: {
          $cond: [
            { $gt: [{ $size: { $ifNull: ['$splits', []] } }, 0] },
            '$splits',
            [{ category_id: '$category_id', amount: AMOUNT }],
          ],
        },
      },
    },
    { $unwind: '$_parts' },
    {
      $addFields: {
        part_category_id: '$_parts.category_id',
        part_amount: '$_parts.amount',
      },
    },
  ];
}

/**
 * Group by category, honouring splits - the shape the callers already expect:
 * { _id, total, count }.
 *
 * `count` is the number of transactions that touched the category. A split
 * bill counts once against each category it was split across, which is what
 * "how many transactions were there in Food?" means to a reader.
 */
export function groupByCategoryStages({ withCount = true } = {}) {
  return [
    ...splitExpansionStages(),
    {
      $group: {
        _id: '$part_category_id',
        total: { $sum: '$part_amount' },
        ...(withCount ? { count: { $sum: 1 } } : {}),
      },
    },
  ];
}

/**
 * Stages that reduce each transaction to the money attributed to one set of
 * categories - used by budgets, where only the budget's own category counts.
 *
 * A bill split half to Food and half to Shopping puts only its Food half
 * against a Food budget, which is the whole point of splitting it (REQ-32,
 * REQ-50).
 *
 * `categoryIds` is a list of ObjectIds; pass null to take every category, for
 * an overall budget.
 */
export function amountForCategoriesStages(categoryIds) {
  const stages = splitExpansionStages();

  if (categoryIds) {
    stages.push({ $match: { part_category_id: { $in: categoryIds } } });
  }

  return stages;
}
