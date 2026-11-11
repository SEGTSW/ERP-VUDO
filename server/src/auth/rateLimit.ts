/**
 * Обмеження спроб входу: не більше MAX невдалих спроб за WINDOW на пару «IP + логін»
 * і MAX_IP на IP. Зберігається в пам'яті процесу (один інстанс сервера).
 */
const WINDOW = 15 * 60_000;
const MAX = 10;
const MAX_IP = 50;

const hits = new Map<string, { n: number; until: number }>();

function bump(key: string) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.until < now) hits.set(key, { n: 1, until: now + WINDOW });
  else h.n++;
}

function count(key: string): number {
  const h = hits.get(key);
  return h && h.until >= Date.now() ? h.n : 0;
}

export function loginBlocked(ip: string, login: string): boolean {
  return count(`${ip}|${login}`) >= MAX || count(ip) >= MAX_IP;
}

export function loginFailed(ip: string, login: string) {
  bump(`${ip}|${login}`);
  bump(ip);
}

export function loginSucceeded(ip: string, login: string) {
  hits.delete(`${ip}|${login}`);
}

export function resetLoginLimits() {
  hits.clear();
}

// Прибирання застарілих записів
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.until < now) hits.delete(k);
}, WINDOW).unref();
