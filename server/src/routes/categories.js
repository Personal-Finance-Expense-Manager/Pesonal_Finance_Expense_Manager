import { Router } from 'express';
import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Transaction from '../models/Transaction.js';
import {
  validateNewCategory,
  validateCategoryUpdate,
} from '../validators/category.js';
import {
  createDefaultCategories,
  ensureUncategorized,
  UNCATEGORIZED_NAME,
} from '../services/categoryService.js';

/**
 * Categories - US-12 (#30), SRS 5.4, REQ-35 to REQ-40.
 *
 *   GET    /api/categories                 list, grouped parent -> children   REQ-35
 *   POST   /api/categories/defaults        create the default set             REQ-35
 *   POST   /api/categories                 create custom                      REQ-36, REQ-37, REQ-38
 *   GET    /api/categories/:id             one category
 *   PATCH  /api/categories/:id             edit a custom category             REQ-39
 *   GET    /api/categories/:id/usage       how many transactions use it       REQ-40
 *   DELETE /api/categories/:id?confirm=true  delete and reassign              REQ-39, REQ-40
 *
 * Every query is scoped to req.user.id, so one user can never see or change
 * another user's categories; a foreign id simply returns 404.
 */
const router = Router();

// Names are unique per user and type regardless of letter case (REQ-37):
// "Food" and "food" clash. Strength 2 = compare letters, ignore case.
const NAME_COLLATION = { locale: 'en', strength: 2 };

/** "an expense" / "a income" -> correct article for the message. */
function articleFor(type) {
  return type === 'expense' ? 'an' : 'a';
}

function present(category, childCount = 0) {
  return {
    id: category._id.toString(),
    name: category.name,
    type: category.type,
    parent_category_id: category.parent_category_id
      ? category.parent_category_id.toString()
      : null,
    icon: category.icon ?? null,
    colour: category.colour ?? null,
    is_system: Boolean(category.is_system),
    child_count: childCount,
    created_at: category.createdAt,
    updated_at: category.updatedAt,
  };
}

/** Find one of this user's categories, or null. */
async function findOwned(userId, id) {
  if (!mongoose.isValidObjectId(id)) return null;

  return Category.findOne({ _id: id, user_id: userId });
}

/** Is `name` already taken within this user's categories of this type? (REQ-37) */
async function nameTaken(userId, type, name, exceptId = null) {
  const query = { user_id: userId, type, name };
  if (exceptId) query._id = { $ne: exceptId };

  const clash = await Category.findOne(query).collation(NAME_COLLATION).select('_id');

  return Boolean(clash);
}

// ---------------------------------------------------------------------------
// GET /api/categories - list (REQ-35)
// ---------------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const { type } = req.query;
    const query = { user_id: req.user.id };

    if (type) {
      if (!['expense', 'income'].includes(type)) {
        return res.status(400).json({ message: 'Type must be expense or income.' });
      }
      query.type = type;
    }

    const categories = await Category.find(query)
      .sort({ type: 1, name: 1 })
      .collation(NAME_COLLATION);

    const childCount = new Map();
    for (const c of categories) {
      if (c.parent_category_id) {
        const key = c.parent_category_id.toString();
        childCount.set(key, (childCount.get(key) || 0) + 1);
      }
    }

    const parents = categories.filter((c) => !c.parent_category_id);

    res.json({
      categories: parents.map((parent) => ({
        ...present(parent, childCount.get(parent._id.toString()) || 0),
        children: categories
          .filter(
            (c) =>
              c.parent_category_id &&
              c.parent_category_id.toString() === parent._id.toString()
          )
          .map((child) => present(child)),
      })),
      total: categories.length,
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/categories/defaults - seed the default set (REQ-35)
// ---------------------------------------------------------------------------
router.post('/defaults', async (req, res, next) => {
  try {
    const created = await createDefaultCategories(req.user.id);

    res.status(created > 0 ? 201 : 200).json({
      created,
      message:
        created > 0
          ? `Added ${created} default categories.`
          : 'Your default categories are already set up.',
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/categories - create custom (REQ-36, REQ-37, REQ-38)
// ---------------------------------------------------------------------------
router.post('/', async (req, res, next) => {
  try {
    const { data, errors } = validateNewCategory(req.body);
    if (errors) return res.status(400).json({ message: 'Please correct the highlighted fields.', errors });

    // REQ-38: one level of nesting only.
    if (data.parent_category_id) {
      const parent = await findOwned(req.user.id, data.parent_category_id);

      if (!parent) {
        return res.status(400).json({
          message: 'Select a valid parent category.',
          errors: { parent_category_id: 'Parent category not found.' },
        });
      }

      if (parent.parent_category_id) {
        return res.status(400).json({
          message:
            'Subcategories can only be one level deep. Choose a top-level category as the parent.',
          errors: { parent_category_id: 'This category is already a subcategory.' },
        });
      }

      if (parent.type !== data.type) {
        return res.status(400).json({
          message: 'A subcategory must have the same type as its parent.',
          errors: { parent_category_id: `Parent is an ${parent.type} category.` },
        });
      }
    }

    // REQ-37: unique within this user's categories of that type.
    if (await nameTaken(req.user.id, data.type, data.name)) {
      return res.status(409).json({
        message: `You already have ${articleFor(data.type)} ${data.type} category called "${data.name}". Please choose a different name.`,
        errors: { name: 'This name is already in use.' },
      });
    }

    const category = await Category.create({
      user_id: req.user.id,
      name: data.name,
      type: data.type,
      parent_category_id: data.parent_category_id,
      icon: data.icon,
      colour: data.colour,
      is_system: false,
    });

    res.status(201).json({ category: present(category) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'This name is already in use.' });
    }
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/categories/:id
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const category = await findOwned(req.user.id, req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found.' });

    const childCount = await Category.countDocuments({
      user_id: req.user.id,
      parent_category_id: category._id,
    });

    res.json({ category: present(category, childCount) });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/categories/:id - edit a custom category (REQ-39)
// ---------------------------------------------------------------------------
router.patch('/:id', async (req, res, next) => {
  try {
    const category = await findOwned(req.user.id, req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found.' });

    const { data, errors } = validateCategoryUpdate(req.body);
    if (errors) return res.status(400).json({ message: 'Please correct the highlighted fields.', errors });

    // REQ-39: a system-defined category cannot be renamed.
    if (category.is_system && 'name' in data && data.name !== category.name) {
      return res.status(403).json({
        message: `"${category.name}" is a built-in category and cannot be renamed. You can create your own category instead.`,
      });
    }

    if ('name' in data && (await nameTaken(req.user.id, category.type, data.name, category._id))) {
      return res.status(409).json({
        message: `You already have ${articleFor(category.type)} ${category.type} category called "${data.name}". Please choose a different name.`,
        errors: { name: 'This name is already in use.' },
      });
    }

    // REQ-38 again: re-parenting must not create a second level.
    if ('parent_category_id' in data && data.parent_category_id) {
      const parent = await findOwned(req.user.id, data.parent_category_id);

      if (!parent || parent._id.equals(category._id)) {
        return res.status(400).json({ message: 'Select a valid parent category.' });
      }

      if (parent.parent_category_id) {
        return res.status(400).json({
          message: 'Subcategories can only be one level deep.',
        });
      }

      if (parent.type !== category.type) {
        return res.status(400).json({ message: 'A subcategory must have the same type as its parent.' });
      }

      const hasChildren = await Category.countDocuments({
        user_id: req.user.id,
        parent_category_id: category._id,
      });

      if (hasChildren > 0) {
        return res.status(400).json({
          message:
            'This category has subcategories of its own, so it cannot become a subcategory. Move its children first.',
        });
      }
    }

    Object.assign(category, data);
    await category.save();

    res.json({ category: present(category) });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/categories/:id/usage - what a delete would affect (REQ-40)
// ---------------------------------------------------------------------------
router.get('/:id/usage', async (req, res, next) => {
  try {
    const category = await findOwned(req.user.id, req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found.' });

    const [transactionCount, childCount] = await Promise.all([
      Transaction.countDocuments({ user_id: req.user.id, category_id: category._id }),
      Category.countDocuments({ user_id: req.user.id, parent_category_id: category._id }),
    ]);

    res.json({
      category: present(category, childCount),
      transaction_count: transactionCount,
      child_count: childCount,
      can_delete: !category.is_system,
      message: category.is_system
        ? `"${category.name}" is a built-in category and cannot be deleted.`
        : transactionCount === 0
          ? 'No transactions use this category.'
          : `${transactionCount} transaction${transactionCount === 1 ? '' : 's'} will be moved to "${UNCATEGORIZED_NAME}".`,
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/categories/:id?confirm=true (REQ-39, REQ-40)
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res, next) => {
  try {
    const category = await findOwned(req.user.id, req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found.' });

    // REQ-39: system categories are permanent.
    if (category.is_system) {
      return res.status(403).json({
        message: `"${category.name}" is a built-in category and cannot be deleted.`,
      });
    }

    const [transactionCount, children] = await Promise.all([
      Transaction.countDocuments({ user_id: req.user.id, category_id: category._id }),
      Category.find({ user_id: req.user.id, parent_category_id: category._id }).select('_id'),
    ]);

    // REQ-40: say what will happen and require explicit confirmation.
    if (req.query.confirm !== 'true') {
      return res.status(409).json({
        message:
          transactionCount === 0
            ? `Delete "${category.name}"? No transactions use it.`
            : `Delete "${category.name}"? ${transactionCount} transaction${transactionCount === 1 ? '' : 's'} will be moved to "${UNCATEGORIZED_NAME}".`,
        transaction_count: transactionCount,
        child_count: children.length,
        confirmation_required: true,
      });
    }

    let movedTransactions = 0;

    if (transactionCount > 0) {
      const fallback = await ensureUncategorized(req.user.id, category.type);

      const result = await Transaction.updateMany(
        { user_id: req.user.id, category_id: category._id },
        { $set: { category_id: fallback._id } }
      );

      movedTransactions = result.modifiedCount ?? transactionCount;
    }

    // Children are promoted to top level rather than silently deleted, so no
    // category disappears without the user asking for it.
    let promotedChildren = 0;

    if (children.length > 0) {
      const result = await Category.updateMany(
        { user_id: req.user.id, parent_category_id: category._id },
        { $set: { parent_category_id: null } }
      );

      promotedChildren = result.modifiedCount ?? children.length;
    }

    await category.deleteOne();

    res.json({
      deleted: category.name,
      moved_transactions: movedTransactions,
      promoted_children: promotedChildren,
      message:
        movedTransactions > 0
          ? `Deleted "${category.name}". ${movedTransactions} transaction${movedTransactions === 1 ? '' : 's'} moved to "${UNCATEGORIZED_NAME}".`
          : `Deleted "${category.name}".`,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
