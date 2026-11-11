import { useDeferredValue, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ART_TYPES, PNL_LINES, fmtDate, isOwner, lineLabel, money } from '@vudo/shared';
import { api, errorText } from '../api';
import { useMe } from '../session';
import { useDrawer } from '../orders/hooks';
import { CashModal, useArticles, useRefreshFinance, type ArticleRow, type CashRow } from '../finance/CashModal';
import { ConfirmButton, Modal, WarnBox } from '../ui/common';
import { SubTabs } from '../ui/bits';
import { useToast } from '../ui/toast';

type Tab = 'cash' | 'pnl' | 'pay' | 'debt' | 'des' | 'sal' | 'fixed' | 'arts';
const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const plain = (n: number) => money(n).replace(/\s?грн$/, '');

/** 10. Фінанси (власник — усі вкладки) / Оплати (менеджер — оплати й борги). */
export function Finance() {
  const { user } = useMe();
  const owner = isOwner(user);
  const tabs: [Tab, string][] = owner
    ? [
        ['cash', 'Облік'],
        ['pnl', 'P&L'],
        ['pay', 'Оплати клієнтів'],
        ['debt', 'Борги клієнтів'],
        ['des', 'Дизайнерам'],
        ['sal', 'Нарахування'],
        ['fixed', 'Постійні витрати'],
        ['arts', 'Статейник'],
      ]
    : [
        ['pay', 'Оплати клієнтів'],
        ['debt', 'Борги клієнтів'],
      ];
  const [tab, setTab] = useState<Tab>(tabs[0]![0]);
  return (
    <>
      <div className="bar">
        <h1 className="grow">{owner ? 'Фінанси' : 'Оплати'}</h1>
      </div>
      <div style={{ marginBottom: 14 }}>
        <SubTabs tabs={tabs} cur={tab} onChange={setTab} />
      </div>
      {tab === 'cash' && <CashTab />}
      {tab === 'arts' && <ArtsTab />}
      {!['cash', 'arts'].includes(tab) && (
        <div className="stub">
          <b>Вкладка в розробці</b>
          <span>З'явиться в наступній частині етапу «Фінанси».</span>
        </div>
      )}
    </>
  );
}

/* ---------- 10.1 Облік ---------- */

interface CashData {
  rows: CashRow[];
  total: number;
  inflow: number;
  outflow: number;
  balances: { card: number; cash: number; total: number };
  months: string[];
  today: string;
}

function CashTab() {
  const { openOrder } = useDrawer();
  const toast = useToast();
  const refresh = useRefreshFinance();
  const arts = useArticles().data ?? [];
  const [month, setMonth] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [cat, setCat] = useState('');
  const [text, setText] = useState('');
  const [modal, setModal] = useState<{ edit?: CashRow } | null>(null);
  const q = useDeferredValue(text);
  const params = new URLSearchParams({ type, cat, q, ...(month != null ? { month } : {}) });
  const d = useQuery({ queryKey: ['finance', 'cash', month, type, cat, q], queryFn: () => api.get<CashData>(`/finance/cash?${params}`) });
  const data = d.data;
  const cur = month ?? data?.today.slice(0, 7) ?? '';
  const months = data ? [...new Set([data.today.slice(0, 7), ...data.months])].sort().reverse() : [];
  const cats = [...new Set(arts.filter((a) => !a.hidden && (!type || a.type === type)).map((a) => a.cat).filter(Boolean))];
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/finance/cash/${id}`),
    onSuccess: () => {
      refresh();
      toast('Операцію видалено');
    },
    onError: (e) => toast(errorText(e), true),
  });
  const b = data?.balances;
  return (
    <>
      <div className="sums" style={{ marginBottom: 14 }}>
        <div>
          <small>Надходження</small>
          <b>{money(data?.inflow ?? 0)}</b>
        </div>
        <div>
          <small>Витрати</small>
          <b className="debt">{money(data?.outflow ?? 0)}</b>
        </div>
        <div>
          <small>Чистий потік</small>
          <b>{money((data?.inflow ?? 0) + (data?.outflow ?? 0))}</b>
        </div>
      </div>
      <div className="sums" style={{ marginBottom: 14 }}>
        <div>
          <small>Залишок на карті</small>
          <b className={(b?.card ?? 0) < 0 ? 'debt' : ''}>{money(b?.card ?? 0)}</b>
        </div>
        <div>
          <small>Залишок готівка</small>
          <b className={(b?.cash ?? 0) < 0 ? 'debt' : ''}>{money(b?.cash ?? 0)}</b>
        </div>
        <div style={{ background: 'var(--accent-soft)' }}>
          <small>Загальний залишок</small>
          <b style={{ fontWeight: 600 }} className={(b?.total ?? 0) < 0 ? 'debt' : ''}>
            {money(b?.total ?? 0)}
          </b>
          <span className="muted" style={{ fontSize: 11.5 }}>
            станом на {fmtDate(data?.today)}
          </span>
        </div>
      </div>
      <div className="bar">
        <select value={month ?? cur} onChange={(e) => setMonth(e.target.value)} aria-label="Місяць">
          <option value="">Увесь час</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthName(m)}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => (setType(e.target.value), setCat(''))} aria-label="Стаття">
          <option value="">Усі статті</option>
          {ART_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Підстаття">
          <option value="">Усі підстатті</option>
          {cats.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input placeholder="Пошук: об'єкт, примітка, контрагент" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 180 }} aria-label="Пошук" />
        <button type="button" className="btn pri" onClick={() => setModal({})}>
          + Операція
        </button>
      </div>
      <div className="tbl-wrap">
        <table className="tcash">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Стаття</th>
              <th>Підстаття</th>
              <th>Об'єкт</th>
              <th>Контрагент</th>
              <th>Примітка</th>
              <th>P&L</th>
              <th className="r">Карта, грн</th>
              <th className="r">Готівка, грн</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((e) => (
              <tr key={e.key} className={e.derived ? 'derived' : ''}>
                <td className="num">{fmtDate(e.date)}</td>
                <td>{e.type}</td>
                <td>{e.cat}</td>
                <td>
                  {e.orderId ? (
                    <a href={`?order=${e.orderId}`} className="lnk" onClick={(ev) => (ev.preventDefault(), openOrder(e.orderId!))}>
                      {e.obj}
                    </a>
                  ) : (
                    e.obj
                  )}
                </td>
                <td>{e.counterparty}</td>
                <td className="nt">
                  {e.note}
                  {e.derived && <span className="chip"> з {e.derived === 'оплата' ? 'оплат замовлення' : 'виплат дизайнерам'}</span>}
                </td>
                <td>
                  <small className="muted">{lineLabel(e.line)}</small>
                </td>
                <td className={`r num ${e.sum < 0 ? 'debt' : ''}`}>{e.account === 'Карта' ? plain(e.sum) : ''}</td>
                <td className={`r num ${e.sum < 0 ? 'debt' : ''}`}>{e.account === 'Готівка' ? plain(e.sum) : ''}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {!e.derived && (
                    <>
                      <button type="button" className="mini" title="Змінити операцію" aria-label="Змінити операцію" onClick={() => setModal({ edit: e })}>
                        ✎
                      </button>{' '}
                      <ConfirmButton className="mini" confirmText="Точно?" onConfirm={() => del.mutate(e.opId!)}>
                        ✕
                      </ConfirmButton>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.isPending && <div className="empty">Завантаження…</div>}
        {d.isSuccess && !data!.rows.length && <div className="empty">Операцій немає. Змініть фільтри або додайте операцію.</div>}
        {data && data.total > data.rows.length && <div className="note">Показано {data.rows.length} з {data.total}. Звузьте період.</div>}
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        Оплати клієнтів (і виплати дизайнерам) потрапляють сюди автоматично — їх змінюють у замовленні. Рядок P&L для кожної операції береться зі
        статейника. Імпорт вашого обліку з Numbers/Excel буде додано, щойно надішлете файл.
      </div>
      {modal && <CashModal edit={modal.edit} onClose={() => setModal(null)} />}
    </>
  );
}

/* ---------- 10.8 Статейник ---------- */

function ArtsTab() {
  const toast = useToast();
  const refresh = useRefreshFinance();
  const q = useArticles();
  const [adding, setAdding] = useState(false);
  const patch = useMutation({
    mutationFn: (v: { id: number; body: Partial<ArticleRow> }) => api.patch(`/finance/articles/${v.id}`, v.body),
    onSuccess: () => {
      refresh();
      toast('Збережено');
    },
    onError: (e) => {
      toast(errorText(e), true);
      refresh();
    },
  });
  const arts = (q.data ?? []).filter((a) => !a.hidden);
  const groups = ART_TYPES.map((t) => [t, arts.filter((a) => a.type === t)] as const).filter(([, l]) => l.length);
  const cell = (a: ArticleRow, k: 'cat' | 'obj' | 'defaultCp', ph = '') => (
    <input
      defaultValue={a[k]}
      placeholder={ph}
      aria-label={k}
      onBlur={(e) => e.target.value.trim() !== a[k] && patch.mutate({ id: a.id, body: { [k]: e.target.value.trim() } })}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
  return (
    <>
      <div className="bar">
        <p className="muted grow" style={{ margin: 0, fontSize: 13 }}>
          Тут задаються точні назви статей. Для кожної — у який рядок P&L вона йде і чи прив'язується витрата до замовлення. Об'єкт порожній = правило
          для всієї підстатті.
        </p>
        <button type="button" className="btn pri" onClick={() => setAdding(true)}>
          + Стаття
        </button>
      </div>
      <div className="tbl-wrap">
        <table className="tarts">
          <thead>
            <tr>
              <th>Стаття</th>
              <th>Підстаття</th>
              <th>Об'єкт</th>
              <th>Контрагент за замовч.</th>
              <th>Рядок P&L</th>
              <th>До замовлення</th>
              <th className="r">Операцій</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map(([t, list]) =>
              list.map((a, i) => (
                <tr key={a.id}>
                  {i === 0 && (
                    <th rowSpan={list.length} className="tgrp">
                      {t}
                    </th>
                  )}
                  <td>{cell(a, 'cat')}</td>
                  <td>{cell(a, 'obj', 'усі')}</td>
                  <td>{cell(a, 'defaultCp')}</td>
                  <td>
                    <select value={a.line} aria-label="Рядок P&L" onChange={(e) => patch.mutate({ id: a.id, body: { line: e.target.value } })}>
                      {PNL_LINES.map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={a.toOrder} aria-label="До замовлення" onChange={(e) => patch.mutate({ id: a.id, body: { toOrder: e.target.checked } })} />
                  </td>
                  <td className="r num">{a.ops || ''}</td>
                  <td>
                    <ConfirmButton className="mini" onConfirm={() => patch.mutate({ id: a.id, body: { hidden: true } })}>
                      ✕
                    </ConfirmButton>
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        {q.isPending && <div className="empty">Завантаження…</div>}
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        Статейник заповнено з вашого листа «Статті список». Коли надішлете точні назви — замінимо. Перейменування підстатті тут не змінює вже записані
        операції; зміна рядка P&L одразу переносить усі такі операції.
      </div>
      {adding && <ArtModal onClose={() => setAdding(false)} />}
    </>
  );
}

function ArtModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefreshFinance();
  const [v, setV] = useState({ type: 'Витрата', cat: '', obj: '', defaultCp: '', line: 'other', toOrder: false });
  const [err, setErr] = useState('');
  const add = useMutation({
    mutationFn: () => api.post('/finance/articles', v),
    onSuccess: () => {
      refresh();
      toast('Статтю додано');
      onClose();
    },
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal onClose={onClose} onSubmit={() => add.mutate()} labelledBy="art-title">
      <h2 id="art-title">Нова стаття</h2>
      <div className="grid">
        <label className="f">
          Стаття
          <select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
            {ART_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="f">
          Підстаття *
          <input value={v.cat} onChange={(e) => setV({ ...v, cat: e.target.value })} />
        </label>
        <label className="f">
          Об'єкт
          <input value={v.obj} placeholder="порожньо — уся підстаття" onChange={(e) => setV({ ...v, obj: e.target.value })} />
        </label>
        <label className="f">
          Контрагент
          <input value={v.defaultCp} onChange={(e) => setV({ ...v, defaultCp: e.target.value })} />
        </label>
        <label className="f">
          Рядок P&L
          <select value={v.line} onChange={(e) => setV({ ...v, line: e.target.value })}>
            {PNL_LINES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="chk">
        <input type="checkbox" checked={v.toOrder} onChange={(e) => setV({ ...v, toOrder: e.target.checked })} /> Прив'язується до замовлення
      </label>
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
