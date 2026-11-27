import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FUTURE_CLOSED, FUTURE_CLOSED_LABEL, INVEST_LINES, OPEX_LINES, kop, lineLabel, orderCostShown, planSigned, pnlDerived, type LineSums, type PnlLine } from '@vudo/shared';
import { api, errorText } from '../api';
import { ConfirmButton } from '../ui/common';
import { useToast } from '../ui/toast';
import { ImportButton } from './ImportButton';

interface PnlData {
  year: number;
  months: string[];
  fact: Record<string, Record<string, number>>;
  plan: Record<string, Record<string, number>>;
  future: Record<string, { paid: number; unpaid: number }>;
  futureClosed: Record<string, number>;
  /** Суми факту, вписані вручну; computed — що було б без них */
  overrides: { month: string; line: string; amount: number; computed: number | null }[];
  /** Місяці, де факт перенесено з файлу */
  fixed: { month: string; note: string }[];
  before: { plan: LineSums; fact: LineSums } | null;
  notes: { month: string; line: string; text: string }[];
  opening: number;
  years: number[];
  today: string;
}

const MON = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];
const num = (v: number | null | undefined) => (v == null || v === 0 ? '' : kop(v));
const pct = (v: number | null) => (v == null ? '' : `${(Math.round(v * 10) / 10).toLocaleString('uk-UA')}%`);

/** Клітинка плану: зберігається після виходу з поля; витрати — без мінуса. */
function PlanCell({
  value,
  onCommit,
  label,
  className = '',
  title,
}: {
  value: number | undefined;
  onCommit: (v: number | null) => void;
  label: string;
  className?: string;
  title?: string;
}) {
  const [t, setT] = useState<string | null>(null);
  const shown = t ?? (value == null ? '' : kop(value));
  return (
    <input
      className={`pin ${className}`}
      title={title}
      inputMode="decimal"
      value={shown}
      placeholder="—"
      aria-label={label}
      onFocus={(e) => e.target.select()}
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
  const fixFact = useMutation({
    mutationFn: (v: { month: string; line: string; amount: number | null }) => api.put('/finance/pnl/fact', v),
    onSuccess: (_r, v) => {
      for (const k of ['finance', 'log']) void qc.invalidateQueries({ queryKey: [k] });
      toast(v.amount == null ? 'Факт знову пораховано' : 'Суму факту змінено');
    },
    onError: (e) => toast(errorText(e), true),
  });
  const unfix = useMutation({
    mutationFn: (m: string) => api.del(`/finance/pnl/fixed/${m}`),
    onSuccess: () => {
      for (const k of ['finance', 'log']) void qc.invalidateQueries({ queryKey: [k] });
      toast('Факт рахується з обліку');
    },
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

  // Факт рядка на екрані: витрати на замовлення — без закритих майбутніх витрат
  const shown = (k: PnlLine, m: string) => (k === 'orderCost' ? orderCostShown(F(m).orderCost, d.futureClosed[m]) : F(m)[k]);

  // Факт можна виправити вручну: порожнє поле повертає пораховану суму
  const ovOf = (m: string, k: string) => d.overrides.find((x) => x.month === m && x.line === k);
  const factCell = (k: PnlLine, m: string) => {
    const o = ovOf(m, k);
    const v = shown(k, m);
    return (
      <td key={m} className={cc(m)}>
        <PlanCell
          value={v == null || v === 0 ? (o ? 0 : undefined) : v}
          label={`Факт ${lineLabel(k)} ${m}`}
          className={`fact ${(v ?? 0) < 0 ? 'neg' : ''} ${o ? 'ovr' : ''}`}
          title={o ? `Вписано вручну. Пораховано: ${o.computed == null ? '—' : kop(o.computed)}. Очистіть поле, щоб повернути.` : 'Факт з обліку. Можна вписати іншу суму.'}
          onCommit={(x) => fixFact.mutate({ month: m, line: k, amount: x })}
        />
      </td>
    );
  };

  const B = d.before;
  const bc = (v: number | null | undefined, text?: string) => B && <td className={`r num ${(v ?? 0) < 0 ? 'neg' : ''}`}>{text ?? num(v)}</td>;
  const bNet = B ? Object.values(B.plan).reduce<number>((t, v) => t + (v ?? 0), 0) : 0;
  const isFixed = (m: string) => d.fixed.find((x) => x.month === m);
  const noteOf = (m: string, k: string) => d.notes.find((x) => x.month === m && x.line === k)?.text;

  const base = (k: PnlLine) => (
    <Fragment key={k}>
      <tr className="pl">
        <th rowSpan={2}>
          {lineLabel(k)}
          <small>план / факт</small>
        </th>
        {bc(B?.plan[k])}
        {ms.map((m) => (
          <td key={m} className={cc(m)}>
            <PlanCell value={d.plan[m]?.[k]} label={`План ${lineLabel(k)} ${m}`} onCommit={(v) => save.mutate({ month: m, line: k, amount: v })} />
            {noteOf(m, k) && <small className="muted" style={{ display: 'block', whiteSpace: 'normal', textAlign: 'right' }}>{noteOf(m, k)}</small>}
          </td>
        ))}
        <td className="r num">{num(tot((m) => planS(m)[k]))}</td>
      </tr>
      <tr className="fa">
        {bc(B?.fact[k])}
        {ms.map((m) => factCell(k, m))}
        <td className="r num">{num(tot((m) => shown(k, m)))}</td>
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
        {B && bc(isPct ? null : pnlDerived(B.plan)[key], isPct ? pct(pnlDerived(B.plan)[key]) : undefined)}
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
        {B && <td />}
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
      <td colSpan={B ? 14 : 13} style={{ background: 'var(--bg)' }} />
    </tr>
  );
  const futureRow = (label: string, hint: string, get: (m: string) => number, warn = false) => (
    <tr className="fa">
      <th>
        {label}
        <small>{hint}</small>
      </th>
      {B && <td />}
      {ms.map((m) => (
        <td key={m} className={`r num ${cc(m)} ${warn && get(m) > 0 ? 'neg' : ''}`}>
          {num(get(m))}
        </td>
      ))}
      <td className="r num">{num(tot(get))}</td>
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
        <small className="muted">План вводиться в клітинки (витрати без мінуса). Факт рахується з обліку, але суму можна виправити вручну — такі клітинки підсвічені.</small>
      </div>
      {!!d.fixed.length && (
        <div className="note" style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          Факт із файлу (не з обліку). Повернути факт з обліку:
          {d.fixed.map((x) => (
            <span key={x.month} title={x.note}>
              <ConfirmButton className="mini" onConfirm={() => unfix.mutate(x.month)}>
                {`${x.month.slice(5)}.${x.month.slice(0, 4)}${x.note ? ' (немає у файлі)' : ''}`}
              </ConfirmButton>
            </span>
          ))}
        </div>
      )}
      <div className="tbl-wrap pnlwrap" ref={wrap}>
        <table className="pnl">
          <thead>
            <tr>
              <th>Рядок</th>
              {B && <th className="r">До</th>}
              {ms.map((m) => (
                <th key={m} className={`r ${cc(m)}`}>
                  {MON[Number(m.slice(5)) - 1]}
                  {isFixed(m) && <small title={isFixed(m)!.note || 'Факт перенесено з файлу'}> · файл</small>}
                </th>
              ))}
              <th className="r">Разом</th>
            </tr>
          </thead>
          <tbody>
            {sec('Операційна діяльність')}
            <tr className="pl">
              <th>
                Плановий дохід<small>вписується вручну</small>
              </th>
              {bc(B?.plan.income)}
              {ms.map((m) => (
                <td key={m} className={cc(m)}>
                  <PlanCell value={d.plan[m]?.income} label={`Плановий дохід ${m}`} onCommit={(v) => save.mutate({ month: m, line: 'income', amount: v })} />
                </td>
              ))}
              <td className="r num">{num(tot((m) => planS(m).income))}</td>
            </tr>
            <tr className="fa">
              <th>
                Дохід<small>факт</small>
              </th>
              {bc(B?.fact.income)}
              {ms.map((m) => factCell('income', m))}
              <td className="r num">{num(tot((m) => F(m).income))}</td>
            </tr>
            {base('orderCost')}
            <tr className="fa">
              <th>
                {FUTURE_CLOSED_LABEL}
                <small>вписується вручну, без мінуса</small>
              </th>
              {B && <td />}
              {ms.map((m) => (
                <td key={m} className={cc(m)}>
                  <PlanCell value={d.futureClosed[m]} label={`${FUTURE_CLOSED_LABEL} ${m}`} onCommit={(v) => (v != null && v < 0 ? toast('Вкажіть суму без мінуса.', true) : save.mutate({ month: m, line: FUTURE_CLOSED, amount: v }))} />
                </td>
              ))}
              <td className="r num">{num(-tot((m) => d.futureClosed[m]))}</td>
            </tr>
            {derived('Виручка', 'revenue')}
            {derived('Маржа', 'margin', true)}
            {OPEX_LINES.map(base)}
            {derived('Результат операційної діяльності', 'result')}
            {derived('Операційна маржа', 'opMargin', true)}
            {sec('Майбутні витрати')}
            {futureRow('Витрати за місяць, усього', 'сплачені + ще не закриті', (m) => d.future[m]!.paid + d.future[m]!.unpaid)}
            {futureRow('З них сплачено', 'з обліку', (m) => d.future[m]!.paid)}
            {futureRow('З них ще не закрито', 'рахунки до оплати + постійні витрати', (m) => d.future[m]!.unpaid, true)}
            {sec('Інвестиційна діяльність')}
            {INVEST_LINES.map(base)}
            {sec('Рух грошей')}
            <tr className="fa calc">
              <th>
                Чистий грошовий потік<small>факт, усі операції</small>
              </th>
              {bc(bNet)}
              {ms.map((m) => (
                <td key={m} className={`r num ${cc(m)} ${(F(m).net ?? 0) < 0 ? 'neg' : ''}`}>
                  {num(F(m).net)}
                </td>
              ))}
              <td className="r num">{num(tot((m) => F(m).net))}</td>
            </tr>
            <tr className="fa calc">
              <th>
                Залишок на кінець місяця<small>факт, усі каси</small>
              </th>
              {bc(bNet)}
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
        співпраці, рекламація, кредити, оборотні кошти. Операції з рядком «не в P&L» (обмін коштів, зведення) рахуються лише в грошовому потоці й залишку.
        Факт, вписаний вручну, замінює порахований у P&L (рядки, виручка, результат), але не змінює грошовий потік і залишок — вони завжди з обліку.
        Щоб повернути пораховану суму, очистіть клітинку.
        «Майбутні витрати закриті» — частина витрат на замовлення з обліку: факт витрат показується без неї, виручка рахується з обома.
        Майбутні витрати: «ще не закрито» — залишки з «Рахунків до оплати» (за місяцем строку; без строку — поточний місяць) і несплачені щомісячні /
        щотижневі постійні витрати; реєстр платежів сюди не додається.
        Імпорт з Excel: перший стовпець — назва рядка, у заголовку — місяці (ММ.РРРР); рядок без назви під ним — факт. Місяці з фактом у файлі беруть факт із файлу.
      </div>
    </>
  );
}
