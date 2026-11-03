import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, parse, HttpError } from '../utils/http.js';
import { requireInternalToken } from '../middleware/auth.js';
import { runDailyJobs } from '../services/reservationService.js';
import { markDelivery } from '../services/notificationService.js';

/**
 * Endpoints called by AWS Lambda functions (never by browsers).
 * Protected by a shared secret in the X-Internal-Token header.
 */
const router = Router();
router.use(requireInternalToken);

// EventBridge Scheduler -> reminders Lambda -> here (once a day)
router.post(
  '/jobs/daily',
  asyncHandler(async (_req, res) => {
    const result = await runDailyJobs();
    console.log('[internal] daily jobs', result);
    res.json(result);
  }),
);

// Notifier Lambda reports SES delivery result
router.post(
  '/notifications/:id/status',
  asyncHandler(async (req, res) => {
    const { status, error } = parse(
      z.object({ status: z.enum(['sent', 'failed']), error: z.string().max(500).optional() }),
      req.body,
    );
    const ok = await markDelivery(parseInt(req.params.id, 10), status, error);
    if (!ok) throw new HttpError(404, 'Notification not found');
    res.json({ ok: true });
  }),
);

export default router;
