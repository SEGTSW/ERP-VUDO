import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_METHODS, PAYMENT_TYPES, addDays, fmtDate, kyivToday, money, type Status } from '@vudo/shared';
import { api, errorText } from '../api';
import { useDrawer } from '../orders/hooks';
import { useManagers } from '../pages/Orders';
import { Modal, NumberField, WarnBox } from '../ui/common';
import { RowLink, StatusPill } from '../ui/bits';
import { useToast } from '../ui/toast';

/** Період: від–до і кнопки «Цей місяць», «Минулий», «Рік». */
function usePeriod() {
  const t = kyivToday();
  const [p, setP] = useState({ from: `${t.slice(0, 8)}01`, to: t });
  const presets = {
    month: () => setP({ from: `${t.slice(0, 8)}01`, to: t }),
    prev: () => {
      const end = addDays(`${t.slice(0, 8)}01`, -1);
      setP({ from: `${end.slice(0, 8)}01`, to: end });
    },
    year: () => setP({ from: `${t.slice(0, 4)}-01-01`, to: t }),
  };
  return { p, setP, presets };
}

function PeriodBar({ period, children }: { period: ReturnType<typeof usePeriod>; children?: React.ReactNode }) {
  const { p, setP, presets } = period;
  return (
    <div className="bar">
      <label className="f">
        Від
        <input type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} />
      </label>
      <label className="f">
        До
        <input type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} />
      </label>
      <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" className="btn sm" onClick={presets.month}>
          Цей місяць
        </button>
        <button type="button" className="btn sm" onClick={presets.prev}>
          Минулий
        </button>
        <button type="button" className="btn sm" onClick={presets.year}>
          Рік
        </button>
      </div>
      {children}
    </div>
  );
}

function ManagerSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const managers = useManagers();
  return (
    <label className="f">
      Менеджер
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Усі</option>
        {managers.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ---------- 10.3 Оплати клієнтів ---------- */

interface PayData {
  rows: { id: number; date: string; sum: number; type: string; method: string; orderId: number; num: string; client: string; managerName: string; byName: string | null }[];
  total: number;
  count: number;
  byMethod: Record<string, number>;
}

export function PaymentsTab() {
  const { openOrder } = useDrawer();
  const period = usePeriod();
  const [f, setF] = useState({ method: '', type: '', manager: '' });
  const qs = new URLSearchParams({ ...period.p, method: f.method, type: f.type, ...(f.manager ? { manager: f.manager } : {}) });
  const q = useQuery({ queryKey: ['finance', 'payments', qs.toString()], queryFn: () => api.get<PayData>(`/money/payments?${qs}`) });
  const d = q.data;
  return (
    <>
      <PeriodBar period={period}>
        <label className="f">
          Спосіб
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            <option value="">Усі</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="f">
          Тип
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="">Усі</option>
            {PAYMENT_TYPES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <ManagerSelect value={f.manager} onChange={(v) => setF({ ...f, manager: v })} />
      </PeriodBar>
      <div className="sums" style={{ marginBottom: 14 }}>
        <div>
          <small>Надійшло за період</small>
          <b>{money(d?.total ?? 0)}</b>
        </div>
        <div>
          <small>Оплат</small>
          <b>{d?.count ?? 0}</b>
        </div>
        {PAYMENT_METHODS.map((m) => (
          <div key={m}>
            <small>{m}</small>
            <b>{money(d?.byMethod[m] ?? 0)}</b>
          </div>
        ))}
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Замовлення</th>
              <th>Клієнт</th>
              <th>Тип</th>
              <th>Спосіб</th>
              <th>Менеджер</th>
              <th>Вніс(ла)</th>
              <th className="r">Сума</th>
            </tr>
          </thead>
          <tbody>
            {(d?.rows ?? []).map((p) => (
              <RowLink key={p.id} onOpen={() => openOrder(p.orderId, 'pay')}>
                <td className="num">{fmtDate(p.date)}</td>
                <td className="num">№{p.num}</td>
                <td>{p.client}</td>
                <td>{p.type}</td>
                <td>{p.method}</td>
                <td>{p.managerName}</td>
                <td>{p.byName}</td>
                <td className={`r num ${p.type === 'повернення' ? 'debt' : ''}`}>
                  {p.type === 'повернення' ? '−' : ''}
                  {money(p.sum)}
                </td>
              </RowLink>
            ))}
          </tbody>
        </table>
        {q.isPending && <div className="empty">Завантаження…</div>}
        {d && !d.rows.length && <div className="empty">За цей період оплат немає. Змініть дати або фільтри.</div>}
      </div>
    </>
  );
}

/* ---------- 10.4 Борги клієнтів ---------- */

interface DebtData {
  rows: { orderId: number; num: string; client: string; phone: string | null; status: Status; managerName: string; installDate: string | null; price: number; paid: number; debt: number }[];
  total: number;
  afterInstall: number;
}

export function DebtsTab() {
  const { openOrder } = useDrawer();
  const [manager, setManager] = useState('');
  const q = useQuery({ queryKey: ['finance', 'debts', manager], queryFn: () => api.get<DebtData>(`/money/debts${manager ? `?manager=${manager}` : ''}`) });
  const d = q.data;
  return (
    <>
      <div className="bar">
        <ManagerSelect value={manager} onChange={setManager} />
      </div>
      <div className="sums" style={{ marginBottom: 14 }}>
        <div>
          <small>Загальний борг</small>
          <b className={d?.total ? 'debt' : ''}>{money(d?.total ?? 0)}</b>
        </div>
        <div>
          <small>Замовлень з боргом</small>
          <b>{d?.rows.length ?? 0}</b>
        </div>
        <div>
          <small>Борг після монтажу</small>
          <b className={d?.afterInstall ? 'debt' : ''}>{money(d?.afterInstall ?? 0)}</b>
        </div>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Замовлення</th>
              <th>Клієнт</th>
              <th>Статус</th>
              <th>Менеджер</th>
              <th>Монтаж</th>
              <th className="r">Ціна</th>
              <th className="r">Оплачено</th>
              <th className="r">Борг</th>
            </tr>
          </thead>
          <tbody>
            {(d?.rows ?? []).map((o) => (
              <RowLink key={o.orderId} onOpen={() => openOrder(o.orderId, 'pay')}>
                <td className="num">№{o.num}</td>
                <td>
                  <div>{o.client}</div>
                  <small className="muted num">{o.phone}</small>
                </td>
                <td>
                  <StatusPill s={o.status} />
                </td>
                <td>{o.managerName}</td>
                <td className="num">{fmtDate(o.installDate)}</td>
                <td className="r num">{money(o.price)}</td>
                <td className="r num">{money(o.paid)}</td>
                <td className="r num debt">{money(o.debt)}</td>
              </RowLink>
            ))}
          </tbody>
        </table>
        {q.isPending && <div className="empty">Завантаження…</div>}
        {d && !d.rows.length && <div className="empty">Боргів немає.</div>}
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        Тут лише замовлення з підписаним договором. Звернення й прорахунки без договору боргом не вважаються.
      </div>
    </>
  );
}

/* ---------- 10.5 Дизайнерам ---------- */

interface DesRow {
  id: number;
  label: string;
  name: string;
  company: string | null;
  phone: string | null;
  bonusPct: number;
  contracts: number;
  sales: number;
  accrued: number;
  paid: number;
  owe: number;
  expected: number;
  orders: { orderId: number; num: string; client: string; status: string; contractDate: string | null; bonus: number; pct: number; price: number }[];
  payouts: { id: number; sum: number; method: string; date: string; comment: string | null; byName: string | null }[];
}

export function DesignersTab() {
  const { openOrder } = useDrawer();
  const q = useQuery({ queryKey: ['finance', 'designers'], queryFn: () => api.get<{ rows: DesRow[]; owe: number; paidThisMonth: number; expected: number }>('/money/designers') });
  const [open, setOpen] = useState<number | null>(null);
  const [pay, setPay] = useState<DesRow | null>(null);
  const d = q.data;
  return (
    <>
      <div className="sums" style={{ marginBottom: 14 }}>
        <div>
          <small>Винні дизайнерам</small>
          <b className={d?.owe ? 'debt' : ''}>{money(d?.owe ?? 0)}</b>
        </div>
        <div>
          <small>Виплачено цього місяця</small>
          <b>{money(d?.paidThisMonth ?? 0)}</b>
        </div>
        <div>
          <small>Очікується (ще без договору)</small>
          <b>{money(d?.expected ?? 0)}</b>
        </div>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Дизайнер</th>
              <th className="r">Договорів</th>
              <th className="r">Сума договорів</th>
              <th className="r">Бонус</th>
              <th className="r">Нараховано</th>
              <th className="r">Виплачено</th>
              <th className="r">Винні</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(d?.rows ?? []).map((r) => (
              <Fragment key={r.id}>
                <RowLink onOpen={() => setOpen(open === r.id ? null : r.id)}>
                  <td>
                    <div>{r.name}</div>
                    <small className="muted">
                      {r.company ? `${r.company} · ` : ''}
                      <span className="num">{r.phone}</span>
                    </small>
                  </td>
                  <td className="r num">{r.contracts}</td>
                  <td className="r num">{money(r.sales)}</td>
                  <td className="r num">{r.bonusPct}%</td>
                  <td className="r num">{money(r.accrued)}</td>
                  <td className="r num">{money(r.paid)}</td>
                  <td className={`r num ${r.owe > 0 ? 'debt' : ''}`}>{money(r.owe)}</td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    {r.owe > 0 && (
                      <button type="button" className="btn sm pri" onClick={() => setPay(r)}>
                        Виплатити
                      </button>
                    )}
                  </td>
                </RowLink>
                {open === r.id && (
                  <tr className="sub">
                    <td colSpan={8}>
                      <div className="desdet">
                        <div>
                          <h3>Замовлення</h3>
                          {r.orders.length ? (
                            r.orders.map((o) => (
                              <div className="li" key={o.orderId} style={{ cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => openOrder(o.orderId)} onKeyDown={(e) => e.key === 'Enter' && openOrder(o.orderId)}>
                                <div className="m">
                                  №{o.num} · {o.client}
                                  <small>
                                    {o.status}
                                    {o.contractDate ? ` · договір ${fmtDate(o.contractDate)}` : ' · ще без договору'}
                                  </small>
                                </div>
                                <div style={{ textAlign: 'right' }} className="num">
                                  {money(o.bonus)}
                                  <small>
                                    {o.pct}% від {money(o.price)}
                                  </small>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="muted">Замовлень ще немає.</div>
                          )}
                        </div>
                        <div>
                          <h3>Виплати</h3>
                          {r.payouts.length ? (
                            r.payouts.map((p) => (
                              <div className="li" key={p.id}>
                                <div className="m">
                                  {fmtDate(p.date)} · {p.method}
                                  <small>
                                    {p.byName}
                                    {p.comment ? ` · ${p.comment}` : ''}
                                  </small>
                                </div>
                                <b className="num" style={{ fontWeight: 500 }}>
                                  {money(p.sum)}
                                </b>
                              </div>
                            ))
                          ) : (
                            <div className="muted">Виплат ще не було.</div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {q.isPending && <div className="empty">Завантаження…</div>}
        {d && !d.rows.length && <div className="empty">Немає дизайнерів-партнерів. Додайте їх у «Клієнти → Дизайнери-партнери».</div>}
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        Бонус = % дизайнера × ціна замовлення. Нараховується, коли замовлення з джерелом «дизайнер» переходить у «Договір / аванс отримано». % задається в
        картці дизайнера (інакше — із налаштувань). Виплати не видаляються і потрапляють в облік як «Співпраці».
      </div>
      {pay && <PayoutModal r={pay} onClose={() => setPay(null)} />}
    </>
  );
}

function PayoutModal({ r, onClose }: { r: DesRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ sum: String(r.owe), method: 'картка', date: kyivToday(), comment: '' });
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/money/designers/${r.id}/payouts`, { ...v, sum: Number(v.sum.replace(',', '.').replace(/\s/g, '')) }),
    onSuccess: () => {
      for (const k of ['finance', 'log']) void qc.invalidateQueries({ queryKey: [k] });
      toast('Виплату записано');
      onClose();
    },
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal onClose={onClose} onSubmit={() => (Number(v.sum.replace(',', '.').replace(/\s/g, '')) > 0 ? save.mutate() : setErr('Вкажіть суму більше 0.'))} labelledBy="dpay-title">
      <h2 id="dpay-title">Виплата дизайнеру</h2>
      <div className="muted">{r.label}</div>
      <div className="grid">
        <label className="f">
          Сума, грн *
          <input inputMode="decimal" value={v.sum} onChange={(e) => setV({ ...v, sum: e.target.value })} />
        </label>
        <label className="f">
          Спосіб
          <select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="f">
          Дата
          <input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        </label>
      </div>
      <label className="f">
        Коментар
        <input value={v.comment} onChange={(e) => setV({ ...v, comment: e.target.value })} />
      </label>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={save.isPending}>
          Записати виплату
        </button>
      </div>
    </Modal>
  );
}

/* ---------- 10.6 Нарахування ---------- */

export function SalariesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const period = usePeriod();
  const qs = new URLSearchParams(period.p);
  const q = useQuery({
    queryKey: ['finance', 'salaries', qs.toString()],
    queryFn: () => api.get<{ rows: { id: number; name: string; roles: string[]; contracts: number; sales: number; pay: number | null }[]; pct: number | null; total: number }>(`/money/salaries?${qs}`),
  });
  const setPct = useMutation({
    mutationFn: (v: number | null) => api.patch('/settings', { mgrPct: v }),
    onSuccess: () => {
      for (const k of ['finance', 'settings', 'log']) void qc.invalidateQueries({ queryKey: [k] });
      toast('Збережено');
    },
    onError: (e) => toast(errorText(e), true),
  });
  const d = q.data;
  return (
    <>
      <PeriodBar period={period}>
        <label className="f">
          Менеджерам, % від продажів
          <NumberField
            value={d?.pct ?? null}
            placeholder="вкажіть %"
            onCommit={(v) => (v != null && (v < 0 || v > 100) ? toast('Вкажіть число від 0 до 100.', true) : setPct.mutate(v))}
          />
        </label>
      </PeriodBar>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Працівник</th>
              <th>Роль</th>
              <th className="r">Договорів за період</th>
              <th className="r">Сума продажів</th>
              <th className="r">Ставка</th>
              <th className="r">Нараховано</th>
            </tr>
          </thead>
          <tbody>
            {(d?.rows ?? []).map((r) => (
              <tr key={r.id} style={{ cursor: 'default' }}>
                <td>{r.name}</td>
                <td>{r.roles.join(', ')}</td>
                <td className="r num">{r.contracts}</td>
                <td className="r num">{money(r.sales)}</td>
                <td className="r num">{d?.pct ? `${d.pct}%` : '—'}</td>
                <td className="r num">{r.pay != null ? money(r.pay) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.isPending && <div className="empty">Завантаження…</div>}
      </div>
      <div className="sums" style={{ margin: '14px 0' }}>
        <div>
          <small>Разом до виплати</small>
          <b>{money(d?.total ?? 0)}</b>
        </div>
      </div>
      <div className="note">Продаж зараховується в місяць підписання договору, за ціною договору (без Відмов). Ставку задає лише власник.</div>
    </>
  );
}
