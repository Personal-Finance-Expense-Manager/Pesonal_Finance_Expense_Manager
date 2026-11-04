import { ApiError } from './apiError.js';

/** Parse ?page and ?limit the way GET /api/transactions does (limit 1..100). */
export function parsePagination(query, { defaultLimit = 25 } = {}) {
  const page = Number(query.page ?? '1');
  const limit = Number(query.limit ?? String(defaultLimit));

  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, 'Page must be positive and limit must be between 1 and 100.');
  }
  return { page, limit };
}
