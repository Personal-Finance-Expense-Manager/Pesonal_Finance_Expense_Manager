import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseName,
  validateNewCategory,
  validateCategoryUpdate,
  NAME_MAX_LENGTH,
} from '../src/validators/category.js';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
} from '../src/services/categoryService.js';

// ---------------------------------------------------------------------------
// REQ-35: the default set covers the twelve categories named in the SRS
// ---------------------------------------------------------------------------

test('REQ-35 default categories cover every name the SRS lists', () => {
  const names = [
    ...DEFAULT_EXPENSE_CATEGORIES.map((c) => c.name),
    ...DEFAULT_INCOME_CATEGORIES.map((c) => c.name),
  ];

  for (const required of [
    'Food', 'Groceries', 'Transport', 'Rent', 'Utilities', 'Health',
    'Education', 'Entertainment', 'Shopping', 'Salary', 'Interest', 'Other',
  ]) {
    assert.ok(names.includes(required), `missing default category: ${required}`);
  }
});

test('REQ-35 defaults include both expense and income categories', () => {
  assert.ok(DEFAULT_EXPENSE_CATEGORIES.length > 0);
  assert.ok(DEFAULT_INCOME_CATEGORIES.length > 0);
});

// ---------------------------------------------------------------------------
// REQ-36: name up to 30 characters, type expense or income, icon and colour
// ---------------------------------------------------------------------------

test('REQ-36 creates a valid custom category', () => {
  const { data, errors } = validateNewCategory({
    name: '  Weekend   Dining ',
    type: 'Expense',
    icon: 'utensils',
    colour: '#f97316',
  });

  assert.equal(errors, undefined);
  assert.deepEqual(data, {
    name: 'Weekend Dining',
    type: 'expense',
    icon: 'utensils',
    colour: '#F97316',
    parent_category_id: null,
  });
});

test('REQ-36 rejects a name longer than 30 characters', () => {
  const { errors } = validateNewCategory({ name: 'x'.repeat(NAME_MAX_LENGTH + 1), type: 'expense' });
  assert.match(errors.name, /at most 30 characters/);
});

test('REQ-36 accepts a name of exactly 30 characters', () => {
  const { data, errors } = validateNewCategory({ name: 'x'.repeat(NAME_MAX_LENGTH), type: 'expense' });
  assert.equal(errors, undefined);
  assert.equal(data.name.length, NAME_MAX_LENGTH);
});

test('REQ-36 rejects a type that is neither expense nor income', () => {
  const { errors } = validateNewCategory({ name: 'Food', type: 'savings' });
  assert.match(errors.type, /expense or income/);
});

test('REQ-36 rejects a malformed colour', () => {
  const { errors } = validateNewCategory({ name: 'Food', type: 'expense', colour: 'orange' });
  assert.match(errors.colour, /hex value/);
});

test('REQ-36 treats a missing icon and colour as optional', () => {
  const { data, errors } = validateNewCategory({ name: 'Food', type: 'expense' });
  assert.equal(errors, undefined);
  assert.equal(data.icon, null);
  assert.equal(data.colour, null);
});

// ---------------------------------------------------------------------------
// REQ-37: non-blank, and whitespace does not create near-duplicates
// ---------------------------------------------------------------------------

test('REQ-37 rejects a blank name', () => {
  assert.match(parseName('').error, /cannot be blank/);
});

test('REQ-37 rejects a whitespace-only name', () => {
  assert.match(parseName('     ').error, /cannot be blank/);
});

test('REQ-37 rejects a missing name', () => {
  assert.match(parseName(undefined).error, /required/);
});

test('REQ-37 collapses internal whitespace so near-duplicates cannot be created', () => {
  assert.equal(parseName('Eating    Out').value, 'Eating Out');
});

// ---------------------------------------------------------------------------
// REQ-39: edits are limited to the editable fields
// ---------------------------------------------------------------------------

test('REQ-39 accepts an edit to name, icon and colour', () => {
  const { data, errors } = validateCategoryUpdate({
    name: 'Dining',
    icon: 'fork',
    colour: '#112233',
  });

  assert.equal(errors, undefined);
  assert.deepEqual(data, { name: 'Dining', icon: 'fork', colour: '#112233' });
});

test('REQ-39 refuses to change a category type', () => {
  const { errors } = validateCategoryUpdate({ type: 'income' });
  assert.match(errors.type, /cannot be changed/);
});

test('REQ-39 refuses to change is_system', () => {
  const { errors } = validateCategoryUpdate({ is_system: false });
  assert.match(errors.is_system, /cannot be changed/);
});

test('REQ-39 rejects an empty edit', () => {
  const { errors } = validateCategoryUpdate({});
  assert.match(errors.body, /at least one field/);
});

test('REQ-39 rejects a blank name on edit', () => {
  const { errors } = validateCategoryUpdate({ name: '   ' });
  assert.match(errors.name, /cannot be blank/);
});

// ---------------------------------------------------------------------------
// REQ-38: clearing the parent is allowed (promotes to top level)
// ---------------------------------------------------------------------------

test('REQ-38 allows the parent to be cleared', () => {
  const { data, errors } = validateCategoryUpdate({ parent_category_id: null });
  assert.equal(errors, undefined);
  assert.equal(data.parent_category_id, null);
});
