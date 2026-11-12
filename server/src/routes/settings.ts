import { Router } from 'express';
import { isOwner, STATUSES, type Settings } from '@vudo/shared';
import { pool, tx } from '../db.js';
import { forbidden } from '../errors.js';
import { me, requireOffice } from '../auth/middleware.js';
import { lv, writeLog, type LogEntryInput } from '../audit.js';
import { getSettings, saveSettings, settingsSchema } from '../settings.js';
import { opexInfo } from '../finance/opex.js';

/** Поля, які бачить і змінює лише власник (фінансова звітність). */
const OWNER_ONLY = ['opexPct', 'opexMode', 'mgrPct'] as const;

/** Менеджер не отримує полів звітності навіть у відповіді API. */
function forRole(s: Settings, owner: boolean): Partial<Settings> {
  if (owner) return s;
  const { opexPct: _a, opexMode: _b, mgrPct: _c, ...rest } = s;
  return rest;
}

const pctStr = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);

export const settingsRouter = Router();
settingsRouter.use('/settings', requireOffice);

settingsRouter.get('/settings', async (req, res) => {
  const s = await getSettings(pool);
  const owner = isOwner(me(req));
  // Власнику — ще підказки «зараз авто: N%» і «за фактом 3 міс.: N%»
  res.json(owner ? { ...s, opexInfo: await opexInfo(pool, s) } : forRole(s, false));
});

settingsRouter.patch('/settings', async (req, res) => {
  const u = me(req);
  const owner = isOwner(u);
  const patch = settingsSchema.partial().strict().parse(req.body);
  if (!owner && OWNER_ONLY.some((k) => k in patch)) throw forbidden('Це налаштування змінює лише власник.');

  const result = await tx(async (c) => {
    const cur = await getSettings(c, { lock: true });
    const next: Settings = { ...cur, ...patch, norms: patch.norms ?? cur.norms };
    const logs: Omit<LogEntryInput, 'userId'>[] = [];
    const fin = (text: string, finScope: 'pay' | 'report') => logs.push({ folder: 'fin', finScope, text });

    if (next.avansPct !== cur.avansPct) fin(`Мінімальний аванс: ${pctStr(cur.avansPct)} → ${pctStr(next.avansPct)}`, 'pay');
    if (next.markupPct !== cur.markupPct) fin(`Наша націнка: ${pctStr(cur.markupPct)} → ${pctStr(next.markupPct)}`, 'pay');
    if (next.designerPct !== cur.designerPct)
      fin(`Бонус дизайнерам за замовчуванням: ${pctStr(cur.designerPct)} → ${pctStr(next.designerPct)}`, 'pay');
    if (next.opexPct !== cur.opexPct) fin(`Постійні витрати на замовлення: ${pctStr(cur.opexPct)} → ${pctStr(next.opexPct)}`, 'report');
    if (next.opexMode !== cur.opexMode) {
      const m = (v: string) => (v === 'auto' ? 'авто зі списку' : 'вручну');
      fin(`Режим постійних витрат: ${m(cur.opexMode)} → ${m(next.opexMode)}`, 'report');
    }
    if (next.mgrPct !== cur.mgrPct) fin(`Ставка менеджерів: ${pctStr(cur.mgrPct)} → ${pctStr(next.mgrPct)}`, 'report');

    const normChanges = STATUSES.filter((st) => (cur.norms[st] ?? null) !== (next.norms[st] ?? null)).map(
      (st) => `«${st}»: ${lv(cur.norms[st])} → ${lv(next.norms[st])}`,
    );
    if (normChanges.length) logs.push({ folder: 'other', text: `Норма днів у статусі: ${normChanges.join('; ')}` });

    if (logs.length) {
      await saveSettings(c, next, u.id);
      for (const l of logs) await writeLog(c, { ...l, userId: u.id });
    }
    return next;
  });
  res.json(forRole(result, owner));
});
