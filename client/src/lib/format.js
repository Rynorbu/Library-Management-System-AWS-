const TZ = 'Asia/Thimphu';

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }) : '-');

export const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '-';

export function timeAgo(d) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(d);
}

/** "in 1d 4h", "in 35m", "3d overdue" */
export function countdown(d) {
  const ms = new Date(d).getTime() - Date.now();
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const mins = Math.floor((abs % 3600000) / 60000);
  const txt = days ? `${days}d ${hours}h` : hours ? `${hours}h ${mins}m` : `${mins}m`;
  return ms >= 0 ? `in ${txt}` : `${txt} ago`;
}

export const daysUntil = (d) => Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);

export const initials = (name = '') =>
  name
    .replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

export const roleLabel = { student: 'Student', staff: 'Staff', librarian: 'Librarian' };
