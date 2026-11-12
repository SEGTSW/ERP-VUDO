/** 12В Табель: значення клітинки і підсумки. */

export const TIME_CODES: Record<string, string> = { 'В': 'вихідний', 'Л': 'лікарняний', 'ВП': 'відпустка', 'П': 'прогул' };

/**
 * Нормалізує введене значення: години 0–24 (7.5 або 7,5) або позначка (регістр не важливий, латинські B/P теж).
 * Порожньо → '' (очистити). Неправильне → null.
 */
export function parseTimeValue(raw: string): string | null {
  const v = raw.trim().toUpperCase().replace(',', '.').replace(/B/g, 'В').replace(/P/g, 'П');
  if (v === '') return '';
  if (TIME_CODES[v]) return v;
  if (/^\d{1,2}(\.\d{1,2})?$/.test(v) && Number(v) <= 24) return String(Number(v));
  return null;
}

/** Днів = клітинки з годинами > 0; годин = сума; лікарняних, відпустки, прогулів — кількість позначок. */
export function timeTotals(values: string[]) {
  let h = 0;
  let d = 0;
  let l = 0;
  let v = 0;
  let p = 0;
  for (const x of values) {
    if (x === 'Л') l++;
    else if (x === 'ВП') v++;
    else if (x === 'П') p++;
    else if (x !== 'В') {
      const n = Number(x);
      if (n > 0) {
        h += n;
        d++;
      }
    }
  }
  return { days: d, hours: Math.round(h * 100) / 100, sick: l, vacation: v, absent: p };
}

/** Кількість днів у місяці РРРР-ММ і робочі дні (пн–пт). */
export function monthDays(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    const w = new Date(Date.UTC(y, m - 1, i + 1)).getUTCDay();
    return { date, n: i + 1, w, weekend: w === 0 || w === 6 };
  });
}
