/** Формати (ТЗ розділ 1): гроші «40 000 грн», дата ДД.ММ.РРРР, час ГГ:ХХ за Києвом. */

export const TIME_ZONE = 'Europe/Kyiv';

const moneyFmt = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });

/** Округлення до копійок без похибок двійкової арифметики. */
export const round2 = (n: number) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;

export function money(n: number | null | undefined): string {
  return `${moneyFmt.format(round2(n ?? 0))} грн`;
}

/** Частини дати/часу в київському часовому поясі. */
function kyivParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
}

/** Сьогоднішня дата за Києвом у форматі РРРР-ММ-ДД. */
export function kyivToday(now: Date = new Date()): string {
  const p = kyivParts(now);
  return `${p.y}-${p.m}-${p.d}`;
}

/** РРРР-ММ-ДД (або ISO-рядок) → ДД.ММ.РРРР; порожнє → «—». */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}.${m}.${y}`;
  }
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return '—';
  const p = kyivParts(dt);
  return `${p.d}.${p.m}.${p.y}`;
}

/** Момент часу → ДД.ММ.РРРР ГГ:ХХ (Київ). */
export function fmtDateTime(s: string | Date | null | undefined): string {
  if (!s) return '';
  const dt = s instanceof Date ? s : new Date(s);
  if (Number.isNaN(dt.getTime())) return '';
  const p = kyivParts(dt);
  return `${p.d}.${p.m}.${p.y} ${p.hh}:${p.mm}`;
}

/** Кількість календарних днів між двома датами РРРР-ММ-ДД. */
export function daysBetween(a: string, b: string): number {
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((tb - ta) / 86_400_000);
}

/** Дата РРРР-ММ-ДД + n календарних днів. */
export function addDays(s: string, n: number): string {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0] ?? '')
    .join('')
    .toUpperCase();
}

/** Останні 10 цифр телефону — ключ унікальності клієнта. */
export const phoneKey = (p: string | null | undefined) => String(p ?? '').replace(/\D/g, '').slice(-10);
export const phoneDigitsCount = (p: string | null | undefined) => String(p ?? '').replace(/\D/g, '').length;
