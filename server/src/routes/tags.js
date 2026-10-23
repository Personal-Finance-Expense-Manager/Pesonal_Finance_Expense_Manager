import { Router } from 'express';
import Tag from '../models/Tag.js';
import TransactionTag from '../models/TransactionTag.js';

/**
 * Tags - US-13 (#31), SRS 5.4: REQ-41.
 *
 *   GET /api/tags        every tag this user has used, with how often
 *   GET /api/tags?q=foo  the same list narrowed for type-ahead suggestions
 *
 * Attaching tags to a transaction and filtering the list by tag already live
 * in /api/transactions (US-08, US-10). This router adds the third part of
 * REQ-41: suggesting tags the user has used before.
 */
const router = Router();

const SUGGESTION_LIMIT = 10;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    if (q.length > 50) {
      return res.status(400).json({ message: 'Tag name is too long.' });
    }

    const query = { user_id: req.user.id };

    // Matches anywhere in the name so "foo" finds both "food" and "fast food",
    // which is what a type-ahead needs. Case-insensitive.
    if (q) query.name = { $regex: escapeRegex(q), $options: 'i' };

    const tags = await Tag.find(query).select('name').lean();

    if (tags.length === 0) {
      return res.json({ tags: [], total: 0 });
    }

    // How often each tag is actually used, so the most useful suggestions
    // come first rather than the alphabetically luckiest.
    const counts = await TransactionTag.aggregate([
      { $match: { tag_id: { $in: tags.map((t) => t._id) } } },
      { $group: { _id: '$tag_id', count: { $sum: 1 } } },
    ]);

    const countById = new Map(counts.map((c) => [c._id.toString(), c.count]));

    const presented = tags
      .map((tag) => ({
        id: tag._id.toString(),
        name: tag.name,
        usage_count: countById.get(tag._id.toString()) || 0,
      }))
      .sort((a, b) => b.usage_count - a.usage_count || a.name.localeCompare(b.name));

    res.json({
      tags: q ? presented.slice(0, SUGGESTION_LIMIT) : presented,
      total: presented.length,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
