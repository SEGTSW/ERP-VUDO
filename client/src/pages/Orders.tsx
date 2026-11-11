import { useDeferredValue, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ALL_STATUSES, fmtDate, isOffice, money } from '@vudo/shared';
import { api } from '../api';
import { useMe } from '../session';
import type { ExecListItem, OrderListItem } from '../types';
import { useDrawer, usePeople } from '../orders/hooks';
import { NewOrderModal } from '../orders/NewOrderModal';
import { RowLink, StatusPill } from '../ui/bits';

export interface OrderFilters {
  q: string;
  status: string;
  manager: string;
  late: boolean;
  archived: boolean;
}

export const ordersQuery = (f: OrderFilters) => {
  const p = new URLSearchParams({ q: f.q, status: f.status, late: f.late ? '1' : '0', archived: f.archived ? '1' : '0' });
  if (f.manager) p.set('manager', f.manager);
  return `/orders?${p}`;
};

export function useManagers() {
  const people = usePeople();
  return (people.data ?? []).filter((u) => !u.disabled && (u.roles.includes('Менеджер') || u.roles.includes('Адмін')));
}

export function Orders() {
  const { user } = useMe();
  return isOffice(user) ? <OfficeOrders /> : <ExecOrders />;
}

/** 5.1 Список замовлень (менеджер, власник). */
function OfficeOrders() {
  const { user } = useMe();
  const { openOrder } = useDrawer();
  const managers = useManagers();
  const [f, setF] = useState<OrderFilters>({ q: '', status: '', manager: '', late: false, archived: false });
  const [creating, setCreating] = useState(false);
  const q = useDeferredValue(f.q);
  const list = useQuery({ queryKey: ['orders', 'list', { ...f, q }], queryFn: () => api.get<OrderListItem[]>(ordersQuery({ ...f, q })) });
  const late = useQuery({ queryKey: ['orders', 'late'], queryFn: () => api.get<{ count: number }>('/orders-late-count') });

  const rows = list.data ?? [];
  const limit = user.ordersRows;
  const shown = limit ? rows.slice(0, limit) : rows;

  return (
    <>
      <div className="bar">
        <h1 className="grow">Замовлення</h1>
        {!!late.data?.count && (
          <button type="button" className="btn warn sm" onClick={() => setF({ ...f, late: true, archived: false })}>
            Прострочених: {late.data.count}
          </button>
        )}
        <button type="button" className="btn pri" onClick={() => setCreating(true)}>
          + Нове звернення
        </button>
      </div>
      <div className="bar">
        <input
          placeholder="Пошук: номер, ПІБ, телефон"
          value={f.q}
          onChange={(e) => setF({ ...f, q: e.target.value })}
          style={{ flex: 1, minWidth: 200 }}
          aria-label="Пошук"
        />
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Статус">
          <option value="">Усі статуси</option>
          {ALL_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={f.manager} onChange={(e) => setF({ ...f, manager: e.target.value })} aria-label="Менеджер">
          <option value="">Усі менеджери</option>
          {managers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <label className="chk">
          <input type="checkbox" checked={f.late} onChange={(e) => setF({ ...f, late: e.target.checked })} /> Прострочені
        </label>
        <label className="chk">
          <input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} /> Архів
        </label>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>№</th>
              <th>Клієнт</th>
              <th>Статус</th>
              <th>Менеджер</th>
              <th className="r">Ціна</th>
              <th className="r">Оплачено</th>
              <th className="r">Борг</th>
              <th>Створено</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <RowLink key={o.id} className={o.late ? 'is-late' : undefined} onOpen={() => openOrder(o.id)}>
                <td className="num">{o.num}</td>
                <td>
                  <div>{o.client.name}</div>
                  <small className="muted num">{o.client.phone}</small>
                </td>
                <td>
                  <StatusPill s={o.status} />
                  {!!o.late && <div className="late">прострочено на {o.late} дн.</div>}
                </td>
                <td>{o.managerName}</td>
                <td className="r num">{o.price ? money(o.price) : '—'}</td>
                <td className="r num">{o.paid ? money(o.paid) : '—'}</td>
                <td className={`r num ${o.debt > 0 && o.paid > 0 ? 'debt' : ''}`}>{o.price ? money(o.debt) : '—'}</td>
                <td className="num">{fmtDate(o.createdDate)}</td>
              </RowLink>
            ))}
          </tbody>
        </table>
        {list.isPending && <div className="empty">Завантаження…</div>}
        {list.isError && <div className="empty">Не вдалося завантажити. Оновіть сторінку.</div>}
        {list.isSuccess && !rows.length && <div className="empty">Нічого не знайдено. Змініть фільтри або створіть нове звернення.</div>}
        {!!limit && rows.length > limit && (
          <div className="empty" style={{ padding: 12 }}>
            Показано {limit} з {rows.length}. Змініть кількість у «Налаштування → Мій профіль» або звузьте пошук.
          </div>
        )}
      </div>
      {creating && <NewOrderModal onClose={() => setCreating(false)} />}
    </>
  );
}

/** 5.5 Замовлення для виконавців — лише перегляд, без сум. */
function ExecOrders() {
  const { openOrder } = useDrawer();
  const [text, setText] = useState('');
  const [mine, setMine] = useState(false);
  const q = useDeferredValue(text);
  const list = useQuery({
    queryKey: ['orders', 'exec', q, mine],
    queryFn: () => api.get<ExecListItem[]>(`/orders?${new URLSearchParams({ q, mine: mine ? '1' : '0' })}`),
  });
  const rows = list.data ?? [];
  return (
    <>
      <div className="bar">
        <h1 className="grow">Замовлення</h1>
      </div>
      <div className="bar">
        <input
          placeholder="Пошук: номер, клієнт, адреса, телефон"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
          aria-label="Пошук"
        />
        <label className="chk">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Тільки де є мої етапи
        </label>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>№</th>
              <th>Клієнт</th>
              <th>Адреса</th>
              <th>Статус</th>
              <th>Вироби</th>
              <th>Мої етапи</th>
              <th>Монтаж</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <RowLink key={o.id} onOpen={() => openOrder(o.id)}>
                <td className="num">{o.num}</td>
                <td>
                  <div>{o.client.name}</div>
                  <small className="muted num">{o.client.phone}</small>
                </td>
                <td>{o.address || '—'}</td>
                <td>
                  <StatusPill s={o.status} />
                </td>
                <td>{o.itemNames.join(', ') || '—'}</td>
                <td>{o.myStages.join(', ') || <span className="muted">—</span>}</td>
                <td className="num">{fmtDate(o.installDate)}</td>
              </RowLink>
            ))}
          </tbody>
        </table>
        {list.isPending && <div className="empty">Завантаження…</div>}
        {list.isSuccess && !rows.length && <div className="empty">Замовлень не знайдено.</div>}
      </div>
    </>
  );
}
