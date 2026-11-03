import { HttpError } from '../utils/http.js';

export function notFound(req, _res, next) {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Something went wrong';

  // Postgres errors
  if (err.code === '23505') {
    status = 409;
    message = err.constraint?.includes('email')
      ? 'An account with this email already exists'
      : err.constraint?.includes('isbn')
        ? 'A book with this ISBN already exists'
        : 'That record already exists';
  } else if (err.code === '23503') {
    status = 409;
    message = 'This record is still referenced by other data';
  } else if (err.code === '23514') {
    status = 422;
    message = 'That change would break a data rule (for example, negative copies)';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = 'File is too large (max 5 MB)';
  }

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    if (process.env.NODE_ENV === 'production') message = 'Internal server error';
  }
  res.status(status).json({ error: message, ...(err instanceof HttpError && err.details ? { details: err.details } : {}) });
}
