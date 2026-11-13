import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtDate, kyivToday, money } from '@vudo/shared';
import { api, errorText } from '../api';
import { useDrawer } from '../orders/hooks';
import { ConfirmButton, Modal, WarnBox } from '../ui/common';
import { RowLink } from '../ui/bits';
import { useToast } from '../ui/toast';
import { useArticles } from './CashModal';
import type { OrderListItem } from '../types';

const toNum = (s: string) => Number(s.replace(',', '.').replace(/\s/g, ''));

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['finance', 'log', 'order']) void qc.invalidateQueries({ queryKey: [k] });
  };
}

/* ======================= Позики ======================= */

interface LoanOp {
  id: number;
  date: string;
  kind: 'in' | 'out';
  sum: number;
  method: string;
  doc: string | null;
  note: string | null;
  dueDate: string | null;
  cashOpId: number | null;
  byName: string | null;
  state: { remaining: number; status: string } | null;
}
interface Loan {
  id: number;
  lender: string;
  taxId: string | null;
  contract: string | null;
  contractDate: string | null;
  limit: number | null;
  interest: string;
  note: string | null;
  archived: boolean;
  deposited: number;
  returned: number;
  debt: number;
  overdue: number;
  nextDue: string | null;
  limitLeft: number | null;
  ops: LoanOp[];
}

export function LoansTab() {
  const q = useQuery({ queryKey: ['finance', 'loans'], queryFn: () => api.get<{ rows: Loan[]; debt: number; overdue: number; nextDue: string | null }>('/finance/loans') });
  const [open, setOpen] = useState<number | null>(null);
  const [edit, setEdit] = useState<Loan | 'new' | null>(null);
  const [op, setOp] = useState<{ loan: Loan; kind: 'in' | 'out' } | null>(null);
  const toast = useToast();
  const refresh = useRefresh();
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/finance/loan-ops/${id}`),
    onSuccess: () => (refresh(), toast('Операцію видалено')),
    onError: (e) => toast(errorText(e), true),
  });
  const d = q.data;
  return (
    <>
      <div className="sums" style={{ marginBottom: 14 }}>
        <div>
          <small>Борг ТОВ перед позикодавцями</small>
          <b>{money(d?.debt ?? 0)}</b>
        </div>
        <div>
          <small>Не повернено понад строк</small>
          <b className={d?.overdue ? 'debt' : ''}>{money(d?.overdue ?? 0)}</b>
        </div>
        <div>
          <small>Найближчий строк повернення</small>
          <b>{fmtDate(d?.nextDue)}</b>
        </div>
      </div>
      <div className="bar">
        <span className="grow" />
        <button type="button" className="btn pri" onClick={() => setEdit('new')}>
          + Позикодавець
        </button>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Позикодавець</th>
              <th>Договір</th>
              <th className="r">Внесено</th>
              <th className="r">Повернено</th>
              <th className="r">Борг ТОВ</th>
              <th className="r">Залишок ліміту</th>
              <th>Найближчий строк</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(d?.rows ?? []).map((l) => (
              <Fragment key={l.id}>
                <RowLink className={l.archived ? 'muted' : undefined} onOpen={() => setOpen(open === l.id ? null : l.id)}>
                  <td>
                    <div>{l.lender}</div>
                    {l.taxId && <small className="muted num">РНОКПП {l.taxId}</small>}
                  </td>
                  <td>
                    {l.contract ?? '—'}
                    {l.contractDate && <small className="muted"> від {fmtDate(l.contractDate)}</small>}
                  </td>
                  <td className="r num">{money(l.deposited)}</td>
                  <td className="r num">{money(l.returned)}</td>
                  <td className="r num">
                    <b>{money(l.debt)}</b>
                    {l.overdue > 0 && <small className="debt" style={{ display: 'block' }}>прострочено {money(l.overdue)}</small>}
                  </td>
                  <td className="r num">{l.limitLeft != null ? money(l.limitLeft) : 'ліміт не вказано'}</td>
                  <td className="num">{fmtDate(l.nextDue)}</td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button type="button" className="btn sm pri" onClick={() => setOp({ loan: l, kind: 'in' })}>
                        + Надходження
                      </button>
                      <button type="button" className="btn sm" disabled={l.debt <= 0} onClick={() => setOp({ loan: l, kind: 'out' })}>
                        Повернення
                      </button>
                    </div>
                  </td>
                </RowLink>
                {open === l.id && (
                  <tr className="sub">
                    <td colSpan={8}>
                      <div className="bar" style={{ marginBottom: 6 }}>
                        <b className="grow">Операції</b>
                        <button type="button" className="btn sm" onClick={() => setEdit(l)}>
                          Дані договору
                        </button>
                      </div>
                      {l.ops.length ? (
                        <div className="list">
                          {l.ops.map((o) => (
                            <div className="li" key={o.id}>
                              <div className="m">
                                {fmtDate(o.date)} · {o.kind === 'in' ? 'Надходження' : 'Повернення'} · {o.method}
                                <small>
                                  {[o.doc, o.note, o.byName].filter(Boolean).join(' · ')}
                                  {o.kind === 'in' && o.dueDate ? ` · повернути до ${fmtDate(o.dueDate)}` : ''}
                                  {o.cashOpId ? ' · в обліку' : ' · не в обліку'}
                                </small>
                              </div>
                              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                {o.state && (
                                  <span className={`pill ${o.state.status === 'Прострочено' ? 'g-bad' : o.state.status === 'Повернено' ? 'g-done' : 'g-work'}`}>
                                    {o.state.status}
                                    {o.state.remaining > 0 && o.state.status !== 'Повернено' ? ` · ${money(o.state.remaining)}` : ''}
                                  </span>
                                )}
                                <b className={`num ${o.kind === 'out' ? 'debt' : ''}`} style={{ fontWeight: 500 }}>
                                  {o.kind === 'out' ? '−' : '+'}
                                  {money(o.sum)}
                                </b>
                                <ConfirmButton className="mini" onConfirm={() => del.mutate(o.id)}>
                                  ✕
                                </ConfirmButton>
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="muted">Операцій ще немає.</div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {q.isPending && <div className="empty">Завантаження…</div>}
        {d && !d.rows.length && <div className="empty">Позик ще немає. Натисніть «+ Позикодавець».</div>}
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        Поворотна фінансова допомога: повернення погашають найстаріші внески першими; неповернений залишок після строку — прострочення. Операції можна
        одразу записати в облік (Позика+ / Позика-) — зніміть галочку, якщо рух уже є в обліку.
      </div>
      {edit && <LoanModal loan={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {op && <LoanOpModal loan={op.loan} kind={op.kind} onClose={() => setOp(null)} />}
    </>
  );
}

function LoanModal({ loan, onClose }: { loan: Loan | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [v, setV] = useState({
    lender: loan?.lender ?? '',
    taxId: loan?.taxId ?? '',
    contract: loan?.contract ?? '',
    contractDate: loan?.contractDate ?? '',
    limit: loan?.limit != null ? String(loan.limit) : '',
    interest: loan?.interest ?? 'безвідсоткова',
    note: loan?.note ?? '',
  });
  const [err, setErr] = useState('');
  const body = () => ({ ...v, limit: v.limit.trim() ? toNum(v.limit) : null, contractDate: v.contractDate || null });
  const save = useMutation({
    mutationFn: () => (loan ? api.patch(`/finance/loans/${loan.id}`, body()) : api.post('/finance/loans', body())),
    onSuccess: () => (refresh(), toast('Збережено'), onClose()),
    onError: (e) => setErr(errorText(e)),
  });
  const arch = useMutation({
    mutationFn: () => api.patch(`/finance/loans/${loan!.id}`, { archived: !loan!.archived }),
    onSuccess: () => (refresh(), onClose()),
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal onClose={onClose} onSubmit={() => (v.lender.trim() ? save.mutate() : setErr('Вкажіть позикодавця.'))} labelledBy="loan-title">
      <h2 id="loan-title">{loan ? 'Позика' : 'Новий позикодавець'}</h2>
      <div className="grid">
        <label className="f">
          Позикодавець (ПІБ) *
          <input value={v.lender} onChange={(e) => setV({ ...v, lender: e.target.value })} />
        </label>
        <label className="f">
          РНОКПП
          <input value={v.taxId} inputMode="numeric" onChange={(e) => setV({ ...v, taxId: e.target.value })} />
        </label>
        <label className="f">
          Договір ПФД №
          <input value={v.contract} onChange={(e) => setV({ ...v, contract: e.target.value })} />
        </label>
        <label className="f">
          Дата договору
          <input type="date" value={v.contractDate} onChange={(e) => setV({ ...v, contractDate: e.target.value })} />
        </label>
        <label className="f">
          Ліміт за договором, грн
          <input inputMode="decimal" value={v.limit} placeholder="не вказано" onChange={(e) => setV({ ...v, limit: e.target.value })} />
        </label>
        <label className="f">
          Відсотки
          <input value={v.interest} onChange={(e) => setV({ ...v, interest: e.target.value })} />
        </label>
      </div>
      <label className="f">
        Примітка
        <input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </label>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        {loan && (
          <button type="button" className="btn warn" style={{ marginRight: 'auto' }} onClick={() => arch.mutate()}>
            {loan.archived ? 'Повернути з архіву' : 'В архів'}
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={save.isPending}>
          Зберегти
        </button>
      </div>
    </Modal>
  );
}

function LoanOpModal({ loan, kind, onClose }: { loan: Loan; kind: 'in' | 'out'; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [v, setV] = useState({
    date: kyivToday(),
    sum: kind === 'out' ? String(loan.debt) : '',
    method: 'безготівково',
    doc: '',
    note: '',
    dueDate: '',
    toCash: true,
  });
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/finance/loans/${loan.id}/ops`, { ...v, kind, sum: toNum(v.sum), dueDate: v.dueDate || null }),
    onSuccess: () => (refresh(), toast('Операцію записано'), onClose()),
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal onClose={onClose} onSubmit={() => (toNum(v.sum) > 0 ? save.mutate() : setErr('Вкажіть суму більше 0.'))} labelledBy="lop-title">
      <div className="muted" style={{ fontSize: 12 }}>
        {loan.lender} · борг ТОВ {money(loan.debt)}
      </div>
      <h2 id="lop-title">{kind === 'in' ? 'Надходження позики' : 'Повернення позики'}</h2>
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
          Спосіб
          <select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
            <option>безготівково</option>
            <option>готівка</option>
          </select>
        </label>
        {kind === 'in' && (
          <label className="f">
            Повернути до
            <input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
          </label>
        )}
        <label className="f">
          Документ (№ платіжки / квитанції)
          <input value={v.doc} onChange={(e) => setV({ ...v, doc: e.target.value })} />
        </label>
      </div>
      <label className="f">
        Примітка
        <input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </label>
      <label className="chk">
        <input type="checkbox" checked={v.toCash} onChange={(e) => setV({ ...v, toCash: e.target.checked })} /> Записати в облік ({kind === 'in' ? 'Позика+' : 'Позика-'}) — зніміть, якщо рух уже є в обліку
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

/* ======================= Рахунки до оплати ======================= */

interface Payable {
  id: number;
  counterparty: string;
  taxId: string | null;
  iban: string | null;
  purpose: string;
  invoice: string | null;
  amount: number;
  vat: number;
  dueDate: string | null;
  priority: string;
  cat: string;
  obj: string;
  orderId: number | null;
  orderNum: string | null;
  note: string | null;
  cancelled: boolean;
  paid: number;
  left: number;
  status: string;
  purposeText: string;
  payments: { id: number; date: string; sum: number; account: string; cashOpId: number | null; byName: string | null }[];
}

const STATUS_CLS: Record<string, string> = { 'Прострочено': 'g-bad', 'Частково': 'g-work', 'До сплати': 'g-sale', 'Сплачено': 'g-done', 'Скасовано': '' };

export function PayablesTab() {
  const { openOrder } = useDrawer();
  const toast = useToast();
  const q = useQuery({ queryKey: ['finance', 'payables'], queryFn: () => api.get<{ rows: Payable[]; toPay: number; overdue: number; week: number }>('/finance/payables') });
  const [showPaid, setShowPaid] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [edit, setEdit] = useState<Payable | 'new' | null>(null);
  const [pay, setPay] = useState<Payable | null>(null);
  const d = q.data;
  const rows = (d?.rows ?? []).filter((p) => showPaid || (p.left > 0 && !p.cancelled));
  return (
    <>
      <div className="sums" style={{ marginBottom: 14 }}>
        <div>
          <small>До сплати</small>
          <b>{money(d?.toPay ?? 0)}</b>
        </div>
        <div>
          <small>Прострочено</small>
          <b className={d?.overdue ? 'debt' : ''}>{money(d?.overdue ?? 0)}</b>
        </div>
        <div>
          <small>Сплатити за 7 днів</small>
          <b>{money(d?.week ?? 0)}</b>
        </div>
      </div>
      <div className="bar">
        <label className="chk">
          <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} /> Показувати сплачені й скасовані
        </label>
        <span className="grow" />
        <button type="button" className="btn pri" onClick={() => setEdit('new')}>
          + Рахунок
        </button>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Оплатити до</th>
              <th>Контрагент</th>
              <th>За що</th>
              <th>Рахунок</th>
              <th className="r">Сума</th>
              <th className="r">Залишок</th>
              <th>Пріоритет</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <Fragment key={p.id}>
                <RowLink className={p.cancelled ? 'muted' : undefined} onOpen={() => setOpen(open === p.id ? null : p.id)}>
                  <td className="num">{fmtDate(p.dueDate)}</td>
                  <td>
                    <div>{p.counterparty}</div>
                    {p.taxId && <small className="muted num">{p.taxId}</small>}
                  </td>
                  <td>
                    {p.purpose}
                    {p.orderNum && (
                      <small className="muted" style={{ display: 'block' }}>
                        замовлення №{p.orderNum}
                      </small>
                    )}
                  </td>
                  <td>{p.invoice}</td>
                  <td className="r num">
                    {money(p.amount)}
                    {p.vat > 0 && <small className="muted" style={{ display: 'block' }}>ПДВ {money(p.vat)}</small>}
                  </td>
                  <td className="r num">
                    <b>{money(p.left)}</b>
                  </td>
                  <td>{p.priority}</td>
                  <td>
                    <span className={`pill ${STATUS_CLS[p.status] ?? ''}`}>{p.status}</span>
                  </td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    {p.left > 0 && !p.cancelled && (
                      <button type="button" className="btn sm pri" onClick={() => setPay(p)}>
                        Оплатити
                      </button>
                    )}
                  </td>
                </RowLink>
                {open === p.id && (
                  <tr className="sub">
                    <td colSpan={9}>
                      <div className="desdet">
                        <div>
                          <h3>Реквізити</h3>
                          <div className="list">
                            <div className="li">
                              <div className="m">
                                IBAN
                                <small className="num">{p.iban ?? '—'}</small>
                              </div>
                              {p.iban && (
                                <button type="button" className="mini" onClick={() => navigator.clipboard.writeText(p.iban!).then(() => toast('IBAN скопійовано'))}>
                                  Копіювати
                                </button>
                              )}
                            </div>
                            <div className="li">
                              <div className="m">
                                Призначення платежу
                                <small>{p.purposeText}</small>
                              </div>
                              <button type="button" className="mini" onClick={() => navigator.clipboard.writeText(p.purposeText).then(() => toast('Скопійовано'))}>
                                Копіювати
                              </button>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                            <button type="button" className="btn sm" onClick={() => setEdit(p)}>
                              Змінити
                            </button>
                            {p.orderId && (
                              <button type="button" className="btn sm" onClick={() => openOrder(p.orderId!, 'cost')}>
                                Замовлення
                              </button>
                            )}
                          </div>
                        </div>
                        <div>
                          <h3>Оплати</h3>
                          {p.payments.length ? (
                            p.payments.map((x) => (
                              <div className="li" key={x.id}>
                                <div className="m">
                                  {fmtDate(x.date)} · {x.account}
                                  <small>
                                    {x.byName}
                                    {x.cashOpId ? ' · в обліку' : ' · не в обліку'}
                                  </small>
                                </div>
                                <b className="num" style={{ fontWeight: 500 }}>
                                  {money(x.sum)}
                                </b>
                              </div>
                            ))
                          ) : (
                            <div className="muted">Оплат ще не було.</div>
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
        {d && !rows.length && <div className="empty">Немає рахунків до оплати.</div>}
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        Залишок і статус рахуються самі. «Оплатити» (можна частинами) записує витрату в облік зі статтею рахунку; якщо вказано замовлення — у його
        фактичні витрати.
      </div>
      {edit && <PayableModal item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {pay && <PayModal p={pay} onClose={() => setPay(null)} />}
    </>
  );
}

function PayableModal({ item, onClose }: { item: Payable | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const arts = (useArticles().data ?? []).filter((a) => !a.hidden && a.type === 'Витрата');
  const orders = useQuery({ queryKey: ['orders', 'options-all'], queryFn: () => api.get<OrderListItem[]>('/orders') }).data ?? [];
  const [v, setV] = useState({
    counterparty: item?.counterparty ?? '',
    taxId: item?.taxId ?? '',
    iban: item?.iban ?? '',
    purpose: item?.purpose ?? '',
    invoice: item?.invoice ?? '',
    amount: item ? String(item.amount) : '',
    vat: item?.vat ? String(item.vat) : '',
    dueDate: item?.dueDate ?? '',
    priority: item?.priority ?? 'звичайний',
    cat: item?.cat ?? '',
    obj: item?.obj ?? '',
    orderId: item?.orderId ? String(item.orderId) : '',
    note: item?.note ?? '',
  });
  const [err, setErr] = useState('');
  const cats = [...new Set(arts.map((a) => a.cat))];
  const body = () => ({
    ...v,
    amount: toNum(v.amount),
    vat: v.vat.trim() ? toNum(v.vat) : 0,
    dueDate: v.dueDate || null,
    orderId: v.orderId ? Number(v.orderId) : null,
    cat: v.orderId && !v.cat ? 'Замовлення' : v.cat,
  });
  const save = useMutation({
    mutationFn: () => (item ? api.patch(`/finance/payables/${item.id}`, body()) : api.post('/finance/payables', body())),
    onSuccess: () => (refresh(), toast('Збережено'), onClose()),
    onError: (e) => setErr(errorText(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api.patch(`/finance/payables/${item!.id}`, { cancelled: !item!.cancelled }),
    onSuccess: () => (refresh(), onClose()),
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal
      onClose={onClose}
      onSubmit={() => (!v.counterparty.trim() ? setErr('Вкажіть контрагента.') : !(toNum(v.amount) > 0) ? setErr('Вкажіть суму більше 0.') : save.mutate())}
      labelledBy="pay-title"
    >
      <h2 id="pay-title">{item ? 'Рахунок до оплати' : 'Новий рахунок до оплати'}</h2>
      <div className="grid">
        <label className="f">
          Контрагент *
          <input value={v.counterparty} onChange={(e) => setV({ ...v, counterparty: e.target.value })} />
        </label>
        <label className="f">
          ЄДРПОУ / РНОКПП
          <input value={v.taxId} inputMode="numeric" onChange={(e) => setV({ ...v, taxId: e.target.value })} />
        </label>
        <label className="f">
          IBAN
          <input value={v.iban} placeholder="UA…" onChange={(e) => setV({ ...v, iban: e.target.value })} />
        </label>
        <label className="f">
          За що
          <input value={v.purpose} placeholder="за ДСП, фурнітуру…" onChange={(e) => setV({ ...v, purpose: e.target.value })} />
        </label>
        <label className="f">
          Рахунок (№ і дата)
          <input value={v.invoice} onChange={(e) => setV({ ...v, invoice: e.target.value })} />
        </label>
        <label className="f">
          Сума, грн *
          <input inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </label>
        <label className="f">
          у т.ч. ПДВ, грн
          <input inputMode="decimal" value={v.vat} placeholder="без ПДВ" onChange={(e) => setV({ ...v, vat: e.target.value })} />
        </label>
        <label className="f">
          Оплатити до
          <input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
        </label>
        <label className="f">
          Пріоритет
          <select value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>
            {['терміново', 'високий', 'звичайний', 'низький'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="f">
          Замовлення (якщо витрата на замовлення)
          <select value={v.orderId} onChange={(e) => setV({ ...v, orderId: e.target.value })}>
            <option value="">—</option>
            {orders
              .filter((o) => o.status !== 'Відмова')
              .map((o) => (
                <option key={o.id} value={o.id}>
                  №{o.num} · {o.client.name}
                </option>
              ))}
          </select>
        </label>
        <label className="f">
          Підстаття в обліку
          <select value={v.cat} onChange={(e) => setV({ ...v, cat: e.target.value })}>
            <option value="">{v.orderId ? 'Замовлення' : '—'}</option>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {!v.orderId && (
          <label className="f">
            Об'єкт
            <input value={v.obj} onChange={(e) => setV({ ...v, obj: e.target.value })} />
          </label>
        )}
      </div>
      <label className="f">
        Примітка
        <input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </label>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        {item && (
          <button type="button" className="btn warn" style={{ marginRight: 'auto' }} onClick={() => cancel.mutate()}>
            {item.cancelled ? 'Відновити' : 'Скасувати рахунок'}
          </button>
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

function PayModal({ p, onClose }: { p: Payable; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [v, setV] = useState({ date: kyivToday(), sum: String(p.left), account: 'Карта', toCash: true });
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/finance/payables/${p.id}/pay`, { ...v, sum: toNum(v.sum) }),
    onSuccess: () => (refresh(), toast('Оплату записано'), onClose()),
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal onClose={onClose} onSubmit={() => (toNum(v.sum) > 0 ? save.mutate() : setErr('Вкажіть суму більше 0.'))} labelledBy="pp-title">
      <div className="muted" style={{ fontSize: 12 }}>
        {p.counterparty} · залишок {money(p.left)}
      </div>
      <h2 id="pp-title">Оплатити рахунок</h2>
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
            <option>Карта</option>
            <option>Готівка</option>
          </select>
        </label>
      </div>
      <label className="chk">
        <input type="checkbox" checked={v.toCash} onChange={(e) => setV({ ...v, toCash: e.target.checked })} /> Записати витрату в облік — зніміть, якщо оплата вже є в обліку
      </label>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={save.isPending}>
          Оплатити
        </button>
      </div>
    </Modal>
  );
}
