import Category from '../models/Category.js';

/**
 * Category defaults - US-12 (#30), SRS 5.4, REQ-35 and REQ-40.
 */

// REQ-35 names these twelve explicitly ("covering at least ..."), so the list
// is the specification, not a suggestion. Order is the display order.
export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Food', icon: 'utensils', colour: '#F97316' },
  { name: 'Groceries', icon: 'basket', colour: '#84CC16' },
  { name: 'Transport', icon: 'bus', colour: '#0EA5E9' },
  { name: 'Rent', icon: 'home', colour: '#8B5CF6' },
  { name: 'Utilities', icon: 'bolt', colour: '#EAB308' },
  { name: 'Health', icon: 'heart', colour: '#EF4444' },
  { name: 'Education', icon: 'book', colour: '#3B82F6' },
  { name: 'Entertainment', icon: 'film', colour: '#EC4899' },
  { name: 'Shopping', icon: 'bag', colour: '#14B8A6' },
  { name: 'Other', icon: 'dots', colour: '#64748B' },
];

export const DEFAULT_INCOME_CATEGORIES = [
  { name: 'Salary', icon: 'wallet', colour: '#16A34A' },
  { name: 'Interest', icon: 'percent', colour: '#0D9488' },
  { name: 'Other', icon: 'dots', colour: '#64748B' },
];

// REQ-40: transactions whose category is deleted are moved here rather than
// being left dangling. It is created on demand and is a system category, so
// REQ-39 stops the user deleting or renaming it.
export const UNCATEGORIZED_NAME = 'Uncategorized';

/**
 * Create the default categories for a user (REQ-35).
 *
 * Safe to call more than once: anything already present is skipped, so a
 * retried registration cannot produce duplicates.
 *
 * Returns the number of categories created.
 */
export async function createDefaultCategories(userId) {
  const wanted = [
    ...DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c, type: 'expense' })),
    ...DEFAULT_INCOME_CATEGORIES.map((c) => ({ ...c, type: 'income' })),
  ];

  const existing = await Category.find({ user_id: userId })
    .select('name type')
    .lean();

  const seen = new Set(existing.map((c) => `${c.type}:${c.name.toLowerCase()}`));

  const missing = wanted
    .filter((c) => !seen.has(`${c.type}:${c.name.toLowerCase()}`))
    .map((c) => ({
      user_id: userId,
      name: c.name,
      type: c.type,
      icon: c.icon,
      colour: c.colour,
      parent_category_id: null,
      is_system: true,
    }));

  if (missing.length === 0) return 0;

  await Category.insertMany(missing, { ordered: false });

  return missing.length;
}

/**
 * Find - or create - this user's Uncategorized bucket for a given type (REQ-40).
 */
export async function ensureUncategorized(userId, type) {
  const existing = await Category.findOne({
    user_id: userId,
    type,
    name: UNCATEGORIZED_NAME,
  }).collation({ locale: 'en', strength: 2 });

  if (existing) return existing;

  return Category.create({
    user_id: userId,
    name: UNCATEGORIZED_NAME,
    type,
    icon: 'question',
    colour: '#94A3B8',
    parent_category_id: null,
    is_system: true,
  });
}
