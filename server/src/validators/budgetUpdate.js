
import { validateNewBudget } from './budget.js';

/**
 * US-15 / REQ-47
 * Validate an edited budget using the same rules as budget creation.
 */
export function validateBudgetUpdate(body, options) {
  const input = body && typeof body === 'object' ? body : {};

  const allowedFields = [
    'category_id',
    'amount',
    'period_type',
    'period_start',
    'period_end',
  ];

  const unknownFields = Object.keys(input).filter(
    (field) => !allowedFields.includes(field)
      && !['rollover_enabled', 'repeat_enabled'].includes(field),
  );

  if (unknownFields.length) {
    return {
      errors: {
        fields: `Unsupported fields: ${unknownFields.join(', ')}`,
      },
    };
  }

  const { data, errors } = validateNewBudget(input, options);

  if (errors) return { errors };

  const result = { ...data };

  if (typeof input.rollover_enabled === 'boolean') {
    result.rollover_enabled = input.rollover_enabled;
  }

  if (typeof input.repeat_enabled === 'boolean') {
    result.repeat_enabled = input.repeat_enabled;
  }

  if (
    input.rollover_enabled !== undefined
    && typeof input.rollover_enabled !== 'boolean'
  ) {
    return { errors: { rollover_enabled: 'Must be true or false.' } };
  }

  if (
    input.repeat_enabled !== undefined
    && typeof input.repeat_enabled !== 'boolean'
  ) {
    return { errors: { repeat_enabled: 'Must be true or false.' } };
  }

  return { data: result };
}
