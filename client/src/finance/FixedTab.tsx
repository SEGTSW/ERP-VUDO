import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FIXED_PERIODS, lineLabel, money } from '@vudo/shared';
import { api, errorText } from '../api';
import { ConfirmButton, Modal, WarnBox } from '../ui/common';
import { useToast } from '../ui/toast';
import { CashModal, type CashPrefill } from './CashModal';

interface FixedRow {
  id: number;
  name: string;
  cat: string;
  obj: string;
  counterparty: string;
  amount: number;
  period: string;
  active: boolean;
  perMonth: number;
  paid: number;
  line: string;
}

interface FixedData {
  month: string;
  rows: FixedRow[];
  total: number;
  paid: number;
  due: number;
  info: { pct: number; autoPct: number | null; factPct: number | null; fixedTotal: number; base: { value: number; src: string } | null };
  cats: string[];
}

const MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
const plain = (n: number) => money(n).replace(/\s?грн$/, '');

/** 10.7 Постійні витрати: список з періодичністю, «Сплатити», авто-частка на замовлення, перенесення в план P&L. */
export function FixedTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['finance', 'fixed'], queryFn: () => api.get<FixedData>('/finance/fixed') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ opexMode: string; opexPct: number }>('/settings') });
  const [pay, setPay] = useState<CashPrefill | null>(null);
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    for (const k of ['finance', 'settings', 'order', 'log']) void qc.invalidateQueries({ queryKey: [k] });
  };
  const patch = useMutation({
    mutationFn: (v: { id: number; body: Partial<FixedRow> }) => api.patch(`/finance/fixed/${v.id}`, v.body),
    onSuccess: refresh,
    onError: (e) => {
      toast(errorText(e), true);
      refresh();
    },
  });
  const mode = useMutation({
    mutationFn: (m: string) => api.patch('/settings', { opexMode: m }),
    onSuccess: () => (refresh(), toast('Збережено')),
    onError: (e) => toast(errorText(e), true),
  });
  const toPlan = useMutation({
    mutationFn: () => api.post('/finance/fixed/to-plan'),
    onSuccess: () => (refresh(), toast('Перенесено в план P&L на 12 місяців')),
    onError: (e) => toast(errorText(e), true),
  });
  const d = q.data;
  if (q.isPending) return <div className="empty">Завантаження…</div>;
  if (!d) return <div className="warnbox">Не вдалося завантажити.</div>;
  const mn = MONTHS[Number(d.month.slice(5)) - 1];
  const auto = d.info.autoPct;

  const text = (x: FixedRow, k: 'name' | 'obj', list?: string) => (
    <input
      defaultValue={x[k]}
      list={list}
      aria-label={k === 'name' ? 'Назва' : "Об'єкт"}
      onBlur={(e) => e.target.value.trim() !== x[k] && patch.mutate({ id: x.id, body: { [k]: e.target.value.trim() } })}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );

  return (
    <>
      <div className="sums" style={{ marginBottom: 14 }}>
        <div>
          <small>Постійні витрати на місяць</small>
          <b>{money(d.total)}</b>
        </div>
        <div>
          <small>Сплачено за {mn}</small>
          <b>{money(d.paid)}</b>
        </div>
        <div>
          <small>Ще сплатити (щомісячні і щотижневі)</small>
          <b className={d.due ? 'debt' : ''}>{money(d.due)}</b>
        </div>
        <div>
          <small>Частка на замовлення</small>
          <b>{auto != null ? `${auto}%` : '—'}</b>
        </div>
      </div>
      <div className="bar">
        <label className="f">
          Як рахувати постійні витрати на замовлення
          <select value={settings.data?.opexMode ?? 'auto'} onChange={(e) => mode.mutate(e.target.value)}>
            <option value="auto">Авто з цього списку{auto != null ? ` (${auto}% від ціни)` : ' (немає бази — беремо % з налаштувань)'}</option>
            <option value="fixed">Вручну: {settings.data?.opexPct ?? '—'}% від ціни (Налаштування)</option>
          </select>
        </label>
        <span className="grow" />
        <ConfirmButton className="btn sm" confirmText="Точно? Перезапише план" onConfirm={() => toPlan.mutate()}>
          Перенести в план P&L на 12 міс.
        </ConfirmButton>
        <button type="button" className="btn pri" onClick={() => setAdding(true)}>
          + Постійна витрата
        </button>
      </div>
      <div className="tbl-wrap">
        <table className="tfix">
          <thead>
            <tr>
              <th>Назва</th>
              <th>Підстаття</th>
              <th>Об'єкт</th>
              <th>Рядок P&L</th>
              <th className="r">Сума, грн</th>
              <th>Періодичність</th>
              <th className="r">На місяць</th>
              <th>За {mn}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.rows.map((x) => (
              <tr key={x.id} className={x.active ? '' : 'off'}>
                <td>{text(x, 'name')}</td>
                <td>
                  <select value={x.cat} aria-label="Підстаття" onChange={(e) => patch.mutate({ id: x.id, body: { cat: e.target.value } })}>
                    {[...new Set([x.cat, ...d.cats])].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </td>
                <td>{text(x, 'obj')}</td>
                <td>
                  <small className="muted">{lineLabel(x.line)}</small>
                </td>
                <td>
                  <input
                    className="r"
                    inputMode="decimal"
                    defaultValue={String(x.amount)}
                    aria-label="Сума"
                    onBlur={(e) => {
                      const v = Number(e.target.value.replace(',', '.').replace(/\s/g, ''));
                      if (!(v >= 0)) return toast('Сума — число, не менше 0.', true);
                      if (v !== x.amount) patch.mutate({ id: x.id, body: { amount: v } });
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </td>
                <td>
                  <select value={x.period} aria-label="Періодичність" onChange={(e) => patch.mutate({ id: x.id, body: { period: e.target.value } })}>
                    {FIXED_PERIODS.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="r num">{money(x.perMonth)}</td>
                <td>
                  {!x.active ? (
                    <span className="muted">вимкнено</span>
                  ) : x.paid >= x.perMonth - 0.5 ? (
                    <span className="pill g-done">сплачено {plain(x.paid)}</span>
                  ) : (
                    <>
                      {x.paid > 0 && (
                        <span className="pill g-work">
                          {plain(x.paid)} з {plain(x.perMonth)}
                        </span>
                      )}{' '}
                      <button
                        type="button"
                        className={x.paid > 0 ? 'mini' : 'btn sm pri'}
                        onClick={() =>
                          setPay({ cat: x.cat, obj: x.obj, amount: Math.round((x.perMonth - x.paid) * 100) / 100, note: x.name, counterparty: x.counterparty, fixedId: x.id })
                        }
                      >
                        {x.paid > 0 ? 'Доплатити' : 'Сплатити'}
                      </button>
                    </>
                  )}
                </td>
                <td>
                  <button type="button" className="mini" onClick={() => patch.mutate({ id: x.id, body: { active: !x.active } })}>
                    {x.active ? 'Вимк.' : 'Увімк.'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        Постійні витрати — те, що платиться незалежно від кількості замовлень: утримання цеху, витратні матеріали, зв'язок, податок, фіксовані зарплати.
        «Сплатити» записує витрату в облік з цією статтею. Частка на замовлення = постійні витрати на місяць /{' '}
        {d.info.base ? `${d.info.base.src} (${money(d.info.base.value)})` : 'дохід місяця (поки немає ні плану, ні фактичного доходу)'}; вона
        підставляється в кожне замовлення, де постійні витрати не вказані вручну.
        {d.info.factPct != null ? ` За фактом 3 міс.: ${d.info.factPct}%.` : ''} Суми в стартовому списку — приклад, замініть своїми.
      </div>
      {pay && <CashModal prefill={pay} onClose={() => (setPay(null), refresh())} />}
      {adding && <AddFixed cats={d.cats} onClose={() => setAdding(false)} onDone={refresh} />}
    </>
  );
}

function AddFixed({ cats, onClose, onDone }: { cats: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ name: '', cat: cats[0] ?? '', obj: '', counterparty: '', amount: '', period: 'month' });
  const [err, setErr] = useState('');
  const add = useMutation({
    mutationFn: () => api.post('/finance/fixed', { ...v, amount: Number(v.amount.replace(',', '.').replace(/\s/g, '')) || 0 }),
    onSuccess: () => (onDone(), toast('Додано'), onClose()),
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal onClose={onClose} onSubmit={() => (v.name.trim() ? add.mutate() : setErr('Вкажіть назву.'))} labelledBy="fx-title">
      <h2 id="fx-title">Нова постійна витрата</h2>
      <div className="grid">
        <label className="f">
          Назва *
          <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </label>
        <label className="f">
          Підстаття
          <select value={v.cat} onChange={(e) => setV({ ...v, cat: e.target.value })}>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="f">
          Об'єкт
          <input value={v.obj} onChange={(e) => setV({ ...v, obj: e.target.value })} />
        </label>
        <label className="f">
          Контрагент
          <input value={v.counterparty} onChange={(e) => setV({ ...v, counterparty: e.target.value })} />
        </label>
        <label className="f">
          Сума, грн
          <input inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </label>
        <label className="f">
          Періодичність
          <select value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })}>
            {FIXED_PERIODS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={add.isPending}>
          Додати
        </button>
      </div>
    </Modal>
  );
}
