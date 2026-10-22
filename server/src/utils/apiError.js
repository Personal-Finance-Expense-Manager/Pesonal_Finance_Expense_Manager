/**
 * An error that carries the HTTP status and JSON body the client should see.
 * Services throw it; routes turn it into a response with sendApiError().
 */
export class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}

/** Send an ApiError as the standard { message, errors? } body; pass anything else on. */
export function sendApiError(res, next, error) {
  if (error instanceof ApiError) {
    const body = { message: error.message };
    if (error.errors) body.errors = error.errors;
    return res.status(error.status).json(body);
  }
  return next(error);
}
