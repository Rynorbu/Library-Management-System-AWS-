import { config } from '../config.js';

const fmt = (d) =>
  d
    ? new Date(d).toLocaleString('en-GB', { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' })
    : '';
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { timeZone: config.timezone, dateStyle: 'medium' }) : '');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Each template returns { subject, lines[], cta? }.
 * Text and HTML versions are both generated from the same lines.
 */
const templates = {
  reservation_confirmed: ({ book, deadline }) => ({
    subject: `Reserved: ${book.title}`,
    lines: [
      `Your reservation for **${book.title}** by ${book.author} is confirmed.`,
      `A copy is being held for you at the circulation desk until **${fmt(deadline)}**.`,
      book.shelf_location ? `Shelf location: ${book.shelf_location}` : null,
      'Please bring your student or staff ID when you collect it.',
    ],
    cta: { label: 'View my reservations', path: '/my-library' },
  }),
  waitlist_joined: ({ book, position }) => ({
    subject: `You're on the waitlist for ${book.title}`,
    lines: [
      `All copies of **${book.title}** are currently out.`,
      `You are **#${position}** in the queue. We'll email you the moment a copy is ready for you.`,
    ],
    cta: { label: 'Track my waitlist position', path: '/my-library' },
  }),
  book_available: ({ book, deadline }) => ({
    subject: `Now available: ${book.title}`,
    lines: [
      `Good news! **${book.title}** has been returned and a copy is now held for you.`,
      `Please collect it from the circulation desk before **${fmt(deadline)}**, or it will pass to the next person in the queue.`,
      book.shelf_location ? `Shelf location: ${book.shelf_location}` : null,
    ],
    cta: { label: 'View reservation', path: '/my-library' },
  }),
  checked_out: ({ book, dueAt }) => ({
    subject: `Borrowed: ${book.title}`,
    lines: [`You have borrowed **${book.title}**.`, `It is due back on **${fmtDate(dueAt)}**.`, 'Happy reading!'],
    cta: { label: 'See my loans', path: '/my-library' },
  }),
  returned: ({ book }) => ({
    subject: `Returned: ${book.title}`,
    lines: [`Thank you for returning **${book.title}**.`, 'We hope you enjoyed it.'],
    cta: { label: 'Find your next book', path: '/books' },
  }),
  renewed: ({ book, dueAt }) => ({
    subject: `Renewed: ${book.title}`,
    lines: [`Your loan of **${book.title}** has been renewed.`, `The new due date is **${fmtDate(dueAt)}**.`],
    cta: { label: 'See my loans', path: '/my-library' },
  }),
  reservation_cancelled: ({ book, byLibrarian }) => ({
    subject: `Reservation cancelled: ${book.title}`,
    lines: [
      byLibrarian
        ? `Your reservation for **${book.title}** was cancelled by the library. Please contact the circulation desk if you have questions.`
        : `Your reservation for **${book.title}** has been cancelled.`,
    ],
    cta: { label: 'Browse the catalogue', path: '/books' },
  }),
  reservation_expired: ({ book }) => ({
    subject: `Hold expired: ${book.title}`,
    lines: [
      `Your hold on **${book.title}** expired because it was not collected in time.`,
      'You can reserve it again from the catalogue at any time.',
    ],
    cta: { label: 'Reserve again', path: `/books` },
  }),
  pickup_reminder: ({ book, deadline }) => ({
    subject: `Reminder: collect ${book.title}`,
    lines: [
      `**${book.title}** is waiting for you at the circulation desk.`,
      `Please collect it before **${fmt(deadline)}**.`,
    ],
    cta: { label: 'View reservation', path: '/my-library' },
  }),
  due_reminder: ({ book, dueAt }) => ({
    subject: `Due soon: ${book.title}`,
    lines: [
      `**${book.title}** is due back on **${fmtDate(dueAt)}**.`,
      'You can renew it from My Library if nobody is waiting for it.',
    ],
    cta: { label: 'Renew or view loan', path: '/my-library' },
  }),
  overdue_notice: ({ book, dueAt }) => ({
    subject: `Overdue: ${book.title}`,
    lines: [
      `**${book.title}** was due on **${fmtDate(dueAt)}** and is now overdue.`,
      'Please return it to the library as soon as possible so other students can borrow it.',
    ],
    cta: { label: 'View my loans', path: '/my-library' },
  }),
};

export const NOTIFICATION_TYPES = Object.keys(templates);

export function renderEmail(type, data) {
  const tpl = templates[type];
  if (!tpl) throw new Error(`Unknown notification type: ${type}`);
  const { subject, lines, cta } = tpl(data);
  const name = data.user?.name?.split(' ')[0] || 'there';
  const body = lines.filter(Boolean);
  const ctaUrl = cta ? `${config.appUrl.replace(/\/$/, '')}${cta.path}` : null;

  const text = [`Hi ${name},`, '', ...body.map((l) => l.replace(/\*\*/g, '')), '', ctaUrl ? `${cta.label}: ${ctaUrl}` : '', '', '- CST Library']
    .join('\n')
    .trim();

  const htmlLines = body
    .map((l) => `<p style="margin:0 0 14px;line-height:1.6">${esc(l).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`)
    .join('');

  const html = `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1d2433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6e1d6">
<tr><td style="background:#1f3a5f;padding:22px 28px;color:#fff;font-size:18px;font-weight:600">
<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f2b632;margin-right:10px"></span>CST Library</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 18px;font-size:16px">Hi ${esc(name)},</p>${htmlLines}
${ctaUrl ? `<p style="margin:24px 0 0"><a href="${esc(ctaUrl)}" style="display:inline-block;background:#e07a2f;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">${esc(cta.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px;background:#faf8f3;color:#6b7280;font-size:12px">College of Science and Technology &middot; Royal University of Bhutan<br/>This is an automated message from the library reservation system.</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
