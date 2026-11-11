import { useDeferredValue, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CLAIM, CONTRACT_INDEX, REFUSAL, STATUSES, money, moveFields, statusGroup, type Status } from '@vudo/shared';
import { api, errorText } from '../api';
import type { OfficeCard, OrderListItem } from '../types';
import { useDrawer } from '../orders/hooks';
import { NewOrderModal } from '../orders/NewOrderModal';
import { MoveModal } from '../orders/MoveModal';
import { kmoney } from '../ui/bits';
import { useToast } from '../ui/toast';
import { ordersQuery, useManagers } from './Orders';

/** Продажі — усе до договору; Виробництво — від договору, плюс Рекламація. */
const SALES: Status[] = STATUSES.slice(0, CONTRACT_INDEX - 1) as Status[];
const PROD: Status[] = [...(STATUSES.slice(CONTRACT_INDEX - 1) as Status[]), CLAIM];

/** 7. CRM — дошка замовлень за статусами з перетягуванням. */
export function Crm() {
  const { openOrder } = useDrawer();
  const managers = useManagers();
  const qc = useQueryClient();
  const toast = useToast();
  const [pipe, setPipe] = useState<'sales' | 'prod'>('sales');
  const [text, setText] = useState('');
  const [manager, setManager] = useState('');
  const [late, setLate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [drag, setDrag] = useState<OrderListItem | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [move, setMove] = useState<{ order: OrderListItem; to: Status } | null>(null);
  const q = useDeferredValue(text);

  const filters = { q, status: '', manager, late, archived: false };
  const list = useQuery({ queryKey: ['orders', 'list', filters], queryFn: () => api.get<OrderListItem[]>(ordersQuery(filters)) });
  // Лічильники на перемикачі — по всіх активних (без фільтрів)
  const all = useQuery({
    queryKey: ['orders', 'list', { q: '', status: '', manager: '', late: false, archived: false }],
    queryFn: () => api.get<OrderListItem[]>(ordersQuery({ q: '', status: '', manager: '', late: false, archived: false })),
  });
  const orders = list.data ?? [];
  const cols = pipe === 'sales' ? SALES : PROD;
  const inSales = (all.data ?? []).filter((o) => SALES.includes(o.status)).length;
  const inProd = (all.data ?? []).filter((o) => PROD.includes(o.status) && o.status !== 'Закрито').length;

  /** Перетягування = спроба переходу за правилами розділу 4 (лише наступний крок). */
  async function drop(o: OrderListItem, to: Status) {
    setDrag(null);
    setOver(null);
    document.body.classList.remove('dragging');
    if (o.status === to) return;
    if (moveFields(o.status, to).length) {
      setMove({ order: o, to });
      return;
    }
    try {
      const card = await api.post<OfficeCard>(`/orders/${o.id}/status`, { to, mode: 'step', values: {} });
      qc.setQueryData(['order', o.id], card);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['log'] });
      toast(`№${o.num}: «${to}»`);
    } catch (e) {
      toast(errorText(e), true);
    }
  }

  const dropProps = (st: Status) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!drag) return;
      e.preventDefault();
      setOver(st);
    },
    onDragLeave: () => setOver((x) => (x === st ? null : x)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (drag) void drop(drag, st);
    },
  });

  const sorted = (st: Status) =>
    orders.filter((o) => o.status === st).sort((a, b) => b.late - a.late || a.statusSince.localeCompare(b.statusSince));

  return (
    <>
      <div className="bar">
        <h1 className="grow">CRM</h1>
        <div className="seg">
          <button type="button" aria-current={pipe === 'sales'} onClick={() => setPipe('sales')}>
            Продажі <small>{inSales}</small>
          </button>
          <button type="button" aria-current={pipe === 'prod'} onClick={() => setPipe('prod')}>
            Виробництво <small>{inProd}</small>
          </button>
        </div>
        <button type="button" className="btn pri" onClick={() => setCreating(true)}>
          + Нове звернення
        </button>
      </div>
      <div className="bar">
        <input placeholder="Пошук: номер, ПІБ, телефон" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 180 }} aria-label="Пошук" />
        <select value={manager} onChange={(e) => setManager(e.target.value)} aria-label="Менеджер">
          <option value="">Усі менеджери</option>
          {managers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <label className="chk">
          <input type="checkbox" checked={late} onChange={(e) => setLate(e.target.checked)} /> Прострочені
        </label>
      </div>
      {list.isError && <div className="warnbox">Не вдалося завантажити. Оновіть сторінку.</div>}
      <div className="cols">
        {cols.map((st) => {
          const os = sorted(st);
          return (
            <section key={st} className={`cc-col gc-${statusGroup(st)} ${over === st ? 'over' : ''}`} {...dropProps(st)}>
              <div className="cc-h">
                <div>
                  {st} <span>{os.length}</span>
                </div>
                <small>{os.length ? money(os.reduce((s, o) => s + o.price, 0)) : '—'}</small>
              </div>
              <div className="cc-list">
                {os.map((o) => (
                  <article
                    key={o.id}
                    className={`cc ${o.late ? 'is-late' : ''}`}
                    draggable
                    tabIndex={0}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(o.id));
                      setDrag(o);
                      document.body.classList.add('dragging');
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                      document.body.classList.remove('dragging');
                    }}
                    onClick={() => openOrder(o.id)}
                    onKeyDown={(e) => e.key === 'Enter' && openOrder(o.id)}
                  >
                    <div className="cc-top">
                      <span className="n">№{o.num}</span>
                      {!!o.late && <b className="late">+{o.late} дн.</b>}
                    </div>
                    <div className="who">{o.client.name}</div>
                    <div className="what">{o.itemNames.join(', ') || 'вироби не додано'}</div>
                    {!!o.price && (
                      <div className="cc-money">
                        <b>{money(o.price)}</b>
                        {o.contractDate && o.debt > 0 && <small className="debt">борг {kmoney(o.debt)}</small>}
                      </div>
                    )}
                    <div className={`next ${o.next.cls}`}>{o.next.text}</div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <div className="dz">
        {pipe === 'sales' ? (
          <>
            <div className={`lost ${over === REFUSAL ? 'over' : ''}`} {...dropProps(REFUSAL)}>
              Відмова
            </div>
            <div className={`won ${over === 'Договір / аванс отримано' ? 'over' : ''}`} {...dropProps('Договір / аванс отримано')}>
              Договір ✓
            </div>
          </>
        ) : (
          <>
            <div className={`lost ${over === CLAIM ? 'over' : ''}`} {...dropProps(CLAIM)}>
              Рекламація
            </div>
            <div className={`won ${over === 'Закрито' ? 'over' : ''}`} {...dropProps('Закрито')}>
              Закрити ✓
            </div>
          </>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Перетягніть картку в інший стовпець — система перевірить умови переходу. На телефоні статус змінюється у картці замовлення.
      </p>
      {creating && <NewOrderModal onClose={() => setCreating(false)} />}
      {move && (
        <MoveModal
          orderId={move.order.id}
          num={move.order.num}
          from={move.order.status}
          to={move.to}
          mode="step"
          defaults={{}}
          onClose={() => setMove(null)}
        />
      )}
    </>
  );
}
