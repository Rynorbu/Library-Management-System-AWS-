import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/index.js';
import { HttpError } from '../utils/http.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

async function loadUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Your session has expired - please sign in again');
  }
  const { rows } = await query(
    'SELECT id, name, email, role, student_id, department, is_active, created_at FROM users WHERE id=$1',
    [payload.sub],
  );
  const user = rows[0];
  if (!user || !user.is_active) throw new HttpError(401, 'Account not found or deactivated');
  return user;
}

export const requireAuth = async (req, _res, next) => {
  try {
    req.user = await loadUser(req);
    if (!req.user) throw new HttpError(401, 'Please sign in to continue');
    next();
  } catch (err) {
    next(err);
  }
};

export const optionalAuth = async (req, _res, next) => {
  try {
    req.user = await loadUser(req);
  } catch {
    req.user = null;
  }
  next();
};

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in to continue'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission to do that'));
    next();
  };

export const requireLibrarian = [requireAuth, requireRole('librarian')];

/** Service-to-service calls from Lambda (EventBridge reminders, SES delivery receipts). */
export const requireInternalToken = (req, _res, next) => {
  const supplied = String(req.headers['x-internal-token'] || '');
  const expected = config.internalToken;
  const ok =
    expected &&
    supplied.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!ok) return next(new HttpError(401, 'Invalid internal token'));
  next();
};
