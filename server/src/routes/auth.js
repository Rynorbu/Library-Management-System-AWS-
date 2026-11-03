import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db/index.js';
import { asyncHandler, parse, HttpError } from '../utils/http.js';
import { requireAuth, signToken } from '../middleware/auth.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT || (process.env.NODE_ENV === 'production' ? 50 : 1000)),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts - please try again in a few minutes' },
});

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  studentId: u.student_id,
  department: u.department,
  createdAt: u.created_at,
});

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(100),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  role: z.enum(['student', 'staff']).default('student'),
  studentId: z.string().trim().max(30).optional().or(z.literal('')),
  department: z.string().trim().max(100).optional().or(z.literal('')),
});

router.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(registerSchema, req.body);
    const hash = await bcrypt.hash(data.password, 10);
    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash, role, student_id, department)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [data.name, data.email, hash, data.role, data.studentId || null, data.department || null],
    );
    res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
  }),
);

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const { rows } = await query('SELECT * FROM users WHERE lower(email) = $1', [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new HttpError(401, 'Incorrect email or password');
    }
    if (!user.is_active) throw new HttpError(403, 'This account has been deactivated. Please contact the library.');
    res.json({ token: signToken(user), user: publicUser(user) });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT
         (SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND read_at IS NULL)::int AS unread,
         (SELECT COUNT(*) FROM reservations WHERE user_id=$1 AND status='reserved')::int AS ready,
         (SELECT COUNT(*) FROM loans WHERE user_id=$1 AND returned_at IS NULL AND due_at < now())::int AS overdue`,
      [req.user.id],
    );
    res.json({ user: publicUser(req.user), counts: rows[0] });
  }),
);

const profileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  department: z.string().trim().max(100).optional(),
  studentId: z.string().trim().max(30).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128).optional(),
});

router.put(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = parse(profileSchema, req.body);
    if (data.newPassword) {
      const { rows } = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
      if (!data.currentPassword || !(await bcrypt.compare(data.currentPassword, rows[0].password_hash))) {
        throw new HttpError(400, 'Current password is incorrect');
      }
      await query('UPDATE users SET password_hash=$2 WHERE id=$1', [req.user.id, await bcrypt.hash(data.newPassword, 10)]);
    }
    const { rows } = await query(
      `UPDATE users SET name=COALESCE($2, name), department=COALESCE($3, department), student_id=COALESCE($4, student_id)
        WHERE id=$1 RETURNING *`,
      [req.user.id, data.name ?? null, data.department ?? null, data.studentId ?? null],
    );
    res.json({ user: publicUser(rows[0]) });
  }),
);

export default router;
