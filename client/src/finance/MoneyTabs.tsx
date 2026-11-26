import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACCOUNTS, PAYMENT_METHODS, addDays, isOwner, fmtDate, kyivToday, moneyKop as money, type Status } from '@vudo/shared';
import { api, errorText } from '../api';
import { useDrawer } from '../orders/hooks';
import { useManagers } from '../pages/Orders';
import { ConfirmButton, Modal, NumberField, WarnBox } from '../ui/common';
import { useMe } from '../session';
import type { ArticleRow } from './CashModal';
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

/* ---------- 10.4 Борги клієнтів ---------- */

interface OtherDebt {
  id: number;
  debtor: string;
  phone: string | null;
  reason: string | null;
  amount: number;
  date: string;
  dueDate: string | null;
  cat: string;
  obj: string;
  note: string | null;
  writtenOff: boolean;
  byName: string | null;
  paid: number;
  left: number;
  status: string;
  payments: { id: number; date: string; sum: number; account: string; cashOpId: number | null; byName: string | null }[];
}
interface DebtData {
  rows: { orderId: number; num: string; client: string; phone: string | null; status: Status; managerName: string; installDate: string | null; price: number; paid: number; debt: number }[];
  other: OtherDebt[];
  ordersTotal: number;
  otherTotal: number;
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
        <div>
          <small>Борги без замовлень</small>
          <b className={d?.otherTotal ? 'debt' : ''}>{money(d?.otherTotal ?? 0)}</b>
        </div>
      </div>
      <h3 style={{ margin: '4px 0 8px' }}>По замовленнях · {money(d?.ordersTotal ?? 0)}</h3>
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
      <OtherDebts rows={d?.other ?? []} total={d?.otherTotal ?? 0} />
    </>
  );
}

const DEBT_PILL: Record<string, string> = { Прострочено: 'g-bad', Погашено: 'g-done', Списано: 'g-done', Частково: 'g-work', 'Не сплачено': 'g-work' };
const toNum = (s: string) => Number(s.replace(',', '.').replace(/\s/g, ''));

function useRefreshDebts() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['finance', 'log']) void qc.invalidateQueries({ queryKey: [k] });
  };
}

/** Борги без замовлень: позичили працівнику, переплата постачальнику, інше. */
function OtherDebts({ rows, total }: { rows: OtherDebt[]; total: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const [edit, setEdit] = useState<OtherDebt | 'new' | null>(null);
  const [pay, setPay] = useState<OtherDebt | null>(null);
  const toast = useToast();
  const refresh = useRefreshDebts();
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/money/other-debt-payments/${id}`),
    onSuccess: () => (refresh(), toast('Повернення видалено')),
    onError: (e) => toast(errorText(e), true),
  });
  return (
    <>
      <div className="bar" style={{ marginTop: 22 }}>
        <h3 className="grow" style={{ margin: 0 }}>
          Без замовлень · {money(total)}
        </h3>
        <button type="button" className="btn pri" onClick={() => setEdit('new')}>
          + Борг
        </button>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Хто винен</th>
              <th>За що</th>
              <th>Дата</th>
              <th>Повернути до</th>
              <th className="r">Сума</th>
              <th className="r">Повернено</th>
              <th className="r">Залишок</th>
              <th>Стан</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <Fragment key={x.id}>
                <RowLink className={x.writtenOff || x.left <= 0 ? 'muted' : undefined} onOpen={() => setOpen(open === x.id ? null : x.id)}>
                  <td>
                    <div>{x.debtor}</div>
                    {x.phone && <small className="muted num">{x.phone}</small>}
                  </td>
                  <td>
                    {x.reason ?? '—'}
                    {x.note && <small className="muted" style={{ display: 'block' }}>{x.note}</small>}
                  </td>
                  <td className="num">{fmtDate(x.date)}</td>
                  <td className="num">{fmtDate(x.dueDate)}</td>
                  <td className="r num">{money(x.amount)}</td>
                  <td className="r num">{money(x.paid)}</td>
                  <td className={`r num ${x.left > 0 && !x.writtenOff ? 'debt' : ''}`}>{money(x.left)}</td>
                  <td>
                    <span className={`pill ${DEBT_PILL[x.status] ?? ''}`}>{x.status}</span>
                  </td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button type="button" className="btn sm pri" disabled={x.left <= 0 || x.writtenOff} onClick={() => setPay(x)}>
                        Повернення
                      </button>
                      <button type="button" className="btn sm" onClick={() => setEdit(x)}>
                        ✎
                      </button>
                    </div>
                  </td>
                </RowLink>
                {open === x.id && (
                  <tr className="sub">
                    <td colSpan={9}>
                      {x.payments.length ? (
                        <div className="list">
                          {x.payments.map((p) => (
                            <div className="li" key={p.id}>
                              <div className="m">
                                {fmtDate(p.date)} · повернення · каса: {p.account}
                                <small>
                                  {[p.byName, p.cashOpId ? 'в обліку' : 'не в обліку'].filter(Boolean).join(' · ')}
                                </small>
                              </div>
                              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <b className="num" style={{ fontWeight: 500 }}>+{money(p.sum)}</b>
                                <ConfirmButton className="mini" onConfirm={() => del.mutate(p.id)}>
                                  ✕
                                </ConfirmButton>
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="muted">Повернень ще немає. Вніс(ла): {x.byName ?? '—'}</div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty">Боргів без замовлень немає. Натисніть «+ Борг».</div>}
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        Борги, не пов'язані із замовленнями: позичили працівнику, переплатили постачальнику тощо. Повернення можна одразу записати доходом в облік —
        зніміть галочку, якщо рух уже є в обліку.
      </div>
      {edit && <OtherDebtModal item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {pay && <OtherDebtPayModal d={pay} onClose={() => setPay(null)} />}
    </>
  );
}

function OtherDebtModal({ item, onClose }: { item: OtherDebt | null; onClose: () => void }) {
  const { user } = useMe();
  const owner = isOwner(user);
  const toast = useToast();
  const refresh = useRefreshDebts();
  const arts = useQuery({ queryKey: ['finance', 'articles'], queryFn: () => api.get<ArticleRow[]>('/finance/articles'), enabled: owner }).data ?? [];
  const cats = [...new Set(arts.filter((a) => !a.hidden && a.type === 'Дохід').map((a) => a.cat))];
  const [v, setV] = useState({
    debtor: item?.debtor ?? '',
    phone: item?.phone ?? '',
    reason: item?.reason ?? '',
    amount: item ? String(item.amount) : '',
    date: item?.date ?? kyivToday(),
    dueDate: item?.dueDate ?? '',
    cat: item?.cat ?? 'Інші',
    obj: item?.obj ?? '',
    note: item?.note ?? '',
  });
  const [err, setErr] = useState('');
  const body = () => ({ ...v, amount: toNum(v.amount), dueDate: v.dueDate || null });
  const save = useMutation({
    mutationFn: () => (item ? api.patch(`/money/other-debts/${item.id}`, body()) : api.post('/money/other-debts', body())),
    onSuccess: () => (refresh(), toast('Збережено'), onClose()),
    onError: (e) => setErr(errorText(e)),
  });
  const writeOff = useMutation({
    mutationFn: () => api.patch(`/money/other-debts/${item!.id}`, { writtenOff: !item!.writtenOff }),
    onSuccess: () => (refresh(), onClose()),
    onError: (e) => setErr(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/money/other-debts/${item!.id}`),
    onSuccess: () => (refresh(), toast('Борг видалено'), onClose()),
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal
      onClose={onClose}
      onSubmit={() => (!v.debtor.trim() ? setErr('Вкажіть, хто винен.') : !(toNum(v.amount) > 0) ? setErr('Вкажіть суму більше 0.') : save.mutate())}
      labelledBy="od-title"
    >
      <h2 id="od-title">{item ? 'Борг без замовлення' : 'Новий борг без замовлення'}</h2>
      <div className="grid">
        <label className="f">
          Хто винен *
          <input value={v.debtor} onChange={(e) => setV({ ...v, debtor: e.target.value })} />
        </label>
        <label className="f">
          Телефон
          <input value={v.phone} inputMode="tel" onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </label>
        <label className="f">
          За що
          <input value={v.reason} placeholder="позика працівнику, переплата…" onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </label>
        <label className="f">
          Сума, грн *
          <input inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </label>
        <label className="f">
          Дата
          <input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        </label>
        <label className="f">
          Повернути до
          <input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
        </label>
        {owner && (
          <>
            <label className="f">
              Підстаття доходу в обліку
              <select value={v.cat} onChange={(e) => setV({ ...v, cat: e.target.value })}>
                {[...new Set([v.cat, ...cats])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="f">
              Об'єкт
              <input value={v.obj} onChange={(e) => setV({ ...v, obj: e.target.value })} />
            </label>
          </>
        )}
      </div>
      <label className="f">
        Примітка
        <input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </label>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        {item && (
          <>
            {!item.payments.length && (
              <ConfirmButton className="btn warn" onConfirm={() => remove.mutate()}>
                Видалити
              </ConfirmButton>
            )}
            <button type="button" className="btn warn" style={{ marginRight: 'auto' }} onClick={() => writeOff.mutate()}>
              {item.writtenOff ? 'Відновити' : 'Списати борг'}
            </button>
          </>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Закрити
        </button>
        <button type="submit" className="btn pri" disabled={save.isPending}>
          Зберегти
        </button>
      </div>
    </Modal>
  );
}

function OtherDebtPayModal({ d, onClose }: { d: OtherDebt; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefreshDebts();
  const [v, setV] = useState({ date: kyivToday(), sum: String(d.left), account: 'Готівка', toCash: true });
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/money/other-debts/${d.id}/pay`, { ...v, sum: toNum(v.sum) }),
    onSuccess: () => (refresh(), toast('Повернення записано'), onClose()),
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal onClose={onClose} onSubmit={() => (toNum(v.sum) > 0 ? save.mutate() : setErr('Вкажіть суму більше 0.'))} labelledBy="odp-title">
      <div className="muted" style={{ fontSize: 12 }}>
        {d.debtor} · залишок {money(d.left)}
      </div>
      <h2 id="odp-title">Повернення боргу</h2>
      <div className="grid">
        <label className="f">
          Дата
          <input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        </label>
        <label className="f">
          Сума, грн *
          <input inputMode="decimal" value={v.sum} onChange={(e) => setV({ ...v, sum: e.target.value })} />
        </label>
        <label className="f">
          Каса
          <select value={v.account} onChange={(e) => setV({ ...v, account: e.target.value })}>
            {ACCOUNTS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="chk">
        <input type="checkbox" checked={v.toCash} onChange={(e) => setV({ ...v, toCash: e.target.checked })} /> Записати дохід в облік — зніміть, якщо гроші вже є в обліку
      </label>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={save.isPending}>
          Записати
        </button>
      </div>
    </Modal>
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

/* ---------- 10.6 Нарахування ЗП ---------- */

export function SalariesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const period = usePeriod();
  const qs = new URLSearchParams(period.p);
  const q = useQuery({
    queryKey: ['finance', 'salaries', qs.toString()],
    queryFn: () => api.get<{ rows: { id: number; name: string; roles: string[]; seller: boolean; contracts: number; sales: number; pay: number | null }[]; pct: number | null; total: number }>(`/money/salaries?${qs}`),
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
                <td className="r num">{r.seller || r.contracts ? r.contracts : '—'}</td>
                <td className="r num">{r.seller || r.contracts ? money(r.sales) : '—'}</td>
                <td className="r num">{r.seller && d?.pct ? `${d.pct}%` : '—'}</td>
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
      <div className="note">Продаж зараховується в місяць підписання договору, за ціною договору (без Відмов). Ставка % діє для менеджерів і власника; задає її лише власник.</div>
    </>
  );
}
