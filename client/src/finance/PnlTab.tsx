import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { INVEST_LINES, OPEX_LINES, lineLabel, planSigned, pnlDerived, type LineSums, type PnlLine } from '@vudo/shared';
import { api, errorText } from '../api';
import { useToast } from '../ui/toast';
import { ImportButton } from './ImportButton';

interface PnlData {
  year: number;
  months: string[];
  fact: Record<string, Record<string, number>>;
  plan: Record<string, Record<string, number>>;
  opening: number;
  years: number[];
  today: string;
}

const MON = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];
const num = (v: number | null | undefined) => (v == null || v === 0 ? '' : Math.round(v).toLocaleString('uk-UA'));
const pct = (v: number | null) => (v == null ? '' : `${(Math.round(v * 10) / 10).toLocaleString('uk-UA')}%`);

/** Клітинка плану: зберігається після виходу з поля; витрати — без мінуса. */
function PlanCell({ value, onCommit, label }: { value: number | undefined; onCommit: (v: number | null) => void; label: string }) {
  const [t, setT] = useState<string | null>(null);
  const shown = t ?? (value == null ? '' : String(value));
  return (
    <input
      className="pin"
      inputMode="decimal"
      value={shown}
      placeholder="—"
      aria-label={label}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => {
        if (t == null) return;
        const s = t.trim().replace(',', '.').replace(/\s/g, '');
        setT(null);
        const v = s === '' ? null : Number(s);
        if (v !== null && !Number.isFinite(v)) return;
        if (v !== (value ?? null)) onCommit(v);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** 10.2 P&L: 12 місяців + «Разом»; план (клітинки) і факт (з обліку); розрахункові рядки — сірим. */
export function PnlTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [year, setYear] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['finance', 'pnl', year], queryFn: () => api.get<PnlData>(`/finance/pnl${year ? `?year=${year}` : ''}`) });
  const save = useMutation({
    mutationFn: (v: { month: string; line: string; amount: number | null }) => api.put('/finance/pnl/plan', v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['finance', 'pnl'] }),
    onError: (e) => toast(errorText(e), true),
  });
  const d = q.data;
  const wrap = useRef<HTMLDivElement>(null);
  // При відкритті таблиця прокручена так, щоб було видно поточний місяць
  useLayoutEffect(() => {
    const w = wrap.current;
    const th = w?.querySelector<HTMLElement>('thead th.cur');
    if (w && th) w.scrollLeft = Math.max(0, th.offsetLeft - w.clientWidth + th.offsetWidth * 3);
  }, [d?.year, !!d]);
  if (q.isPending) return <div className="empty">Завантаження…</div>;
  if (!d) return <div className="warnbox">Не вдалося завантажити P&L.</div>;
  const cur = d.today.slice(0, 7);
  const ms = d.months;
  // План зі знаком (для розрахункових рядків)
  const planS = (m: string): LineSums =>
    Object.fromEntries(Object.entries(d.plan[m] ?? {}).map(([k, v]) => [k, planSigned(k as PnlLine, v)])) as LineSums;
  const hasPlan = (m: string) => Object.keys(d.plan[m] ?? {}).length > 0;
  const F = (m: string) => (d.fact[m] ?? {}) as LineSums & { net?: number };
  const tot = (get: (m: string) => number | null | undefined) => ms.reduce((s, m) => s + (get(m) ?? 0), 0);
  const cc = (m: string) => (m === cur ? 'cur' : '');

  const base = (k: PnlLine) => (
    <Fragment key={k}>
      <tr className="pl">
        <th rowSpan={2}>
          {lineLabel(k)}
          <small>план / факт</small>
        </th>
        {ms.map((m) => (
          <td key={m} className={cc(m)}>
            <PlanCell value={d.plan[m]?.[k]} label={`План ${lineLabel(k)} ${m}`} onCommit={(v) => save.mutate({ month: m, line: k, amount: v })} />
          </td>
        ))}
        <td className="r num">{num(tot((m) => planS(m)[k]))}</td>
      </tr>
      <tr className="fa">
        {ms.map((m) => (
          <td key={m} className={`r num ${cc(m)} ${(F(m)[k] ?? 0) < 0 ? 'neg' : ''}`}>
            {num(F(m)[k])}
          </td>
        ))}
        <td className="r num">{num(tot((m) => F(m)[k]))}</td>
      </tr>
    </Fragment>
  );

  const derived = (label: string, key: 'revenue' | 'margin' | 'result' | 'opMargin', isPct = false) => (
    <Fragment key={key}>
      <tr className="pl calc">
        <th rowSpan={2}>
          {label}
          <small>план / факт</small>
        </th>
        {ms.map((m) => {
          const v = hasPlan(m) ? pnlDerived(planS(m))[key] : null;
          return (
            <td key={m} className={`r num ${cc(m)}`}>
              {isPct ? pct(v) : num(v)}
            </td>
          );
        })}
        <td className="r num">{isPct ? '' : num(tot((m) => (hasPlan(m) ? pnlDerived(planS(m))[key] : 0)))}</td>
      </tr>
      <tr className="fa calc">
        {ms.map((m) => {
          const v = pnlDerived(F(m))[key];
          return (
            <td key={m} className={`r num ${cc(m)} ${(v ?? 0) < 0 ? 'neg' : ''}`}>
              {isPct ? pct(v) : num(v)}
            </td>
          );
        })}
        <td className="r num">{isPct ? '' : num(tot((m) => pnlDerived(F(m))[key]))}</td>
      </tr>
    </Fragment>
  );

  // Назва розділу — у закріпленій першій колонці, решта рядка — порожня
  const sec = (t: string) => (
    <tr className="secrow">
      <th>{t}</th>
      <td colSpan={13} style={{ background: 'var(--bg)' }} />
    </tr>
  );
  let bal = d.opening;
  const balance = ms.map((m) => (bal += F(m).net ?? 0));

  return (
    <>
      <div className="bar">
        <select value={d.year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Рік">
          {d.years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <span className="grow" />
        <ImportButton kind="pnl" />
        <small className="muted">План вводиться в клітинки (витрати без мінуса), факт рахується з обліку.</small>
      </div>
      <div className="tbl-wrap pnlwrap" ref={wrap}>
        <table className="pnl">
          <thead>
            <tr>
              <th>Рядок</th>
              {ms.map((m) => (
                <th key={m} className={`r ${cc(m)}`}>
                  {MON[Number(m.slice(5)) - 1]}
                </th>
              ))}
              <th className="r">Разом</th>
            </tr>
          </thead>
          <tbody>
            {sec('Операційна діяльність')}
            {base('income')}
            {base('orderCost')}
            {derived('Виручка', 'revenue')}
            {derived('Маржа', 'margin', true)}
            {OPEX_LINES.map(base)}
            {derived('Результат операційної діяльності', 'result')}
            {derived('Операційна маржа', 'opMargin', true)}
            {sec('Інвестиційна діяльність')}
            {INVEST_LINES.map(base)}
            {sec('Рух грошей')}
            <tr className="fa calc">
              <th>
                Чистий грошовий потік<small>факт, усі операції</small>
              </th>
              {ms.map((m) => (
                <td key={m} className={`r num ${cc(m)} ${(F(m).net ?? 0) < 0 ? 'neg' : ''}`}>
                  {num(F(m).net)}
                </td>
              ))}
              <td className="r num">{num(tot((m) => F(m).net))}</td>
            </tr>
            <tr className="fa calc">
              <th>
                Залишок на кінець місяця<small>факт, рахунок + готівка</small>
              </th>
              {ms.map((m, i) => (
                <td key={m} className={`r num ${cc(m)} ${balance[i]! < 0 ? 'neg' : ''}`}>
                  {m <= cur ? num(balance[i]) : ''}
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        Виручка = дохід + витрати на замовлення (витрати від'ємні). Результат = виручка + адміністративні, ФОП, інші, маркетинг, податки, логістика,
        співпраці, кредити, оборотні кошти. Операції з рядком «не в P&L» (обмін коштів, зведення) рахуються лише в грошовому потоці й залишку.
        План можна імпортувати з Excel: перший стовпець — назва рядка, у заголовку — місяці (ММ.РРРР).
      </div>
    </>
  );
}
