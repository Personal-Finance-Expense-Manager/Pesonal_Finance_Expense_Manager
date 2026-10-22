/**
 * Validation for category input - US-12 (#30), SRS 5.4, REQ-36 to REQ-39.
 *
 * Plain functions with no database access, so they can be unit tested on
 * their own (server/test/category-validation.test.js). Rules that need the
 * database - unique names (REQ-37), one level of nesting (REQ-38) and
 * protecting system categories (REQ-39) - live in routes/categories.js.
 */

// REQ-36: a category is either an expense or an income category.
export const CATEGORY_TYPES = ['expense', 'income'];

// REQ-36: "a name of up to 30 characters".
export const NAME_MAX_LENGTH = 30;

// Fields the user may change on an existing category (REQ-39).
const EDITABLE_FIELDS = ['name', 'icon', 'colour', 'parent_category_id'];

// The type is fixed at creation: moving a category between expense and income
// would silently reclassify every transaction already filed under it.
const READ_ONLY_FIELDS = ['type', 'is_system', 'user_id'];

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

/**
 * Check a category name (REQ-37).
 *
 * Returns { value: 'Food' } or { error: '...' }. Internal whitespace is
 * collapsed so that "Eating   Out" and "Eating Out" cannot both exist.
 */
export function parseName(raw) {
  if (raw === undefined || raw === null) {
    return { error: 'Category name is required.' };
  }

  if (typeof raw !== 'string') {
    return { error: 'Category name must be text.' };
  }

  const name = raw.trim().replace(/\s+/g, ' ');

  if (name.length === 0) {
    return { error: 'Category name cannot be blank.' };
  }

  if (name.length > NAME_MAX_LENGTH) {
    return { error: `Category name can be at most ${NAME_MAX_LENGTH} characters.` };
  }

  return { value: name };
}

function parseType(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { error: 'Category type is required.' };
  }

  const type = String(raw).trim().toLowerCase();

  if (!CATEGORY_TYPES.includes(type)) {
    return { error: 'Category type must be either expense or income.' };
  }

  return { value: type };
}

function parseColour(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null };
  }

  const colour = String(raw).trim();

  if (!HEX_COLOUR.test(colour)) {
    return { error: 'Colour must be a hex value such as #4F46E5.' };
  }

  return { value: colour.toUpperCase() };
}

function parseIcon(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null };
  }

  const icon = String(raw).trim();

  if (icon.length > 40) {
    return { error: 'Icon name can be at most 40 characters.' };
  }

  return { value: icon };
}

/**
 * Validate a new category (REQ-36, REQ-37).
 *
 * Returns { data } on success, or { errors } - a field-keyed object - when
 * something is wrong, matching the shape used by the account validator.
 */
export function validateNewCategory(body = {}) {
  const errors = {};

  const name = parseName(body.name);
  if (name.error) errors.name = name.error;

  const type = parseType(body.type);
  if (type.error) errors.type = type.error;

  const colour = parseColour(body.colour);
  if (colour.error) errors.colour = colour.error;

  const icon = parseIcon(body.icon);
  if (icon.error) errors.icon = icon.error;

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    data: {
      name: name.value,
      type: type.value,
      colour: colour.value,
      icon: icon.value,
      parent_category_id: body.parent_category_id || null,
    },
  };
}

/**
 * Validate an edit (REQ-39).
 *
 * Only the editable fields are accepted. Sending a read-only field is an
 * error rather than a silent no-op, so a mistake in the client is obvious.
 */
export function validateCategoryUpdate(body = {}) {
  const errors = {};
  const data = {};

  for (const field of READ_ONLY_FIELDS) {
    if (field in body) {
      errors[field] =
        field === 'type'
          ? 'A category\'s type cannot be changed. Create a new category instead.'
          : `${field} cannot be changed.`;
    }
  }

  const supplied = Object.keys(body).filter((key) => EDITABLE_FIELDS.includes(key));

  if (supplied.length === 0 && Object.keys(errors).length === 0) {
    return { errors: { body: 'Provide at least one field to change.' } };
  }

  if ('name' in body) {
    const name = parseName(body.name);
    if (name.error) errors.name = name.error;
    else data.name = name.value;
  }

  if ('colour' in body) {
    const colour = parseColour(body.colour);
    if (colour.error) errors.colour = colour.error;
    else data.colour = colour.value;
  }

  if ('icon' in body) {
    const icon = parseIcon(body.icon);
    if (icon.error) errors.icon = icon.error;
    else data.icon = icon.value;
  }

  if ('parent_category_id' in body) {
    data.parent_category_id = body.parent_category_id || null;
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return { data };
}
