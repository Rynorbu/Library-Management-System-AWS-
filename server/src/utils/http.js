export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Wrap an async route handler so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Parse with a zod schema, throwing a 400 with field errors on failure. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) fields[issue.path.join('.') || '_'] = issue.message;
    const first = result.error.issues[0];
    throw new HttpError(400, first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input', fields);
  }
  return result.data;
}

export function pageParams(q, defLimit = 20, maxLimit = 100) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(q.limit, 10) || defLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export async function logActivity(db, { actorId, action, bookId = null, userId = null, details = {} }) {
  await db.query(
    'INSERT INTO activity_log (actor_id, action, book_id, user_id, details) VALUES ($1, $2, $3, $4, $5)',
    [actorId ?? null, action, bookId, userId, JSON.stringify(details)],
  );
}
