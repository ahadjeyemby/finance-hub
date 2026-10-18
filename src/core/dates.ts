// Date helpers on ISO strings only (no timezone surprises).
export const pad = (n: number) => String(n).padStart(2, '0');
export const monthOf = (iso: string) => iso.slice(0, 7);
export const daysInMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const monthStart = (ym: string) => `${ym}-01`;
export const monthEnd = (ym: string) => `${ym}-${pad(daysInMonth(ym))}`;
export const addMonths = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const monthsBetween = (fromYM: string, toYM: string) => { const out: string[] = []; let m = fromYM; while (m <= toYM) { out.push(m); m = addMonths(m, 1); } return out; };
/** Monday of the week containing the ISO date. */
export const weekStart = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); };
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (ym: string, short = false) => { const [y, m] = ym.split('-').map(Number); const n = MONTH_NAMES[m - 1]; return short ? n.slice(0, 3) : `${n} ${y}`; };
export const dayLabel = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}`; };
