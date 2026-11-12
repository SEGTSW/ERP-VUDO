import { useDeferredValue, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtDate } from '@vudo/shared';
import { api, errorText } from '../api';
import type { OrderListItem, StockRow } from '../types';
import { ConfirmButton, Modal, WarnBox } from '../ui/common';
import { RowLink, XlButton } from '../ui/bits';
import { useToast } from '../ui/toast';

const KINDS = ['Плита', 'Стільниця', 'Фурнітура', 'Профіль', 'Інше'] as const;
const UNITS = ['шт', 'м', 'пар', 'уп', 'м²', 'кг'] as const;
const isSheet = (k: string) => k === 'Плита' || k === 'Стільниця';
const area1 = (x: StockRow) => (isSheet(x.kind) && x.w && x.h ? (x.w * x.h) / 1e6 : 0);
const qtyS = (q: number) => String(Math.round(q * 1000) / 1000).replace('.', ',');
const m2 = (v: number) => `${(Math.round(v * 100) / 100).toLocaleString('uk-UA')} м²`;
/** Деталь W×H можна вирізати з обрізка з урахуванням повороту. */
const fits = (x: StockRow, W: number, H: number) => isSheet(x.kind) && !!x.w && !!x.h && ((x.w >= W && x.h >= H) || (x.w >= H && x.h >= W));
const digits = (s: string) => Number(s.replace(/\D/g, '')) || 0;

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['stock', 'order', 'log']) void qc.invalidateQueries({ queryKey: [k] });
  };
}

/** Активні замовлення для вибору «звідки» / «резерв під». Список без сум підходить усім ролям складу. */
function useOrderOptions() {
  const q = useQuery({ queryKey: ['orders', 'options'], queryFn: () => api.get<Pick<OrderListItem, 'id' | 'num' | 'client' | 'status'>[]>('/orders') });
  return (q.data ?? []).filter((o) => o.status !== 'Відмова');
}

/** 8А.4 Склад залишків — обрізки і матеріали після замовлень. Цін і сум немає. */
export function Stock() {
  const q = useQuery({ queryKey: ['stock'], queryFn: () => api.get<StockRow[]>('/stock') });
  const [kind, setKind] = useState('');
  const [text, setText] = useState('');
  const [used, setUsed] = useState(false);
  const [W, setW] = useState('');
  const [H, setH] = useState('');
  const [thick, setThick] = useState('');
  const [modal, setModal] = useState<{ kind: 'edit'; x: StockRow | null } | { kind: 'reserve' | 'use'; x: StockRow } | null>(null);
  const refresh = useRefresh();
  const toast = useToast();
  const search = useDeferredValue(text.trim().toLowerCase());
  const all = q.data ?? [];
  const active = all.filter((x) => x.status !== 'використано');
  const w = digits(W);
  const h = digits(H);
  const picking = !!(w || h);
  const thicks = [...new Set(active.filter((x) => isSheet(x.kind) && x.thick).map((x) => x.thick!))].sort((a, b) => a - b);

  const rows = useMemo(() => {
    const list = all.filter(
      (x) =>
        (used ? x.status === 'використано' : x.status !== 'використано') &&
        (!kind || x.kind === kind) &&
        (!search || `${x.material} ${x.place ?? ''} ${x.note ?? ''}`.toLowerCase().includes(search)) &&
        (!thick || x.thick === Number(thick)) &&
        (!picking || fits(x, w, h)),
    );
    // Підбір: від найменшого підхожого, щоб не різати великий обрізок
    return picking ? list.sort((a, b) => area1(a) - area1(b)) : list;
  }, [all, used, kind, search, thick, picking, w, h]);

  const unres = useMutation({
    mutationFn: (id: number) => api.post(`/stock/${id}/unreserve`),
    onSuccess: () => {
      refresh();
      toast('Резерв знято');
    },
    onError: (e) => toast(errorText(e), true),
  });

  return (
    <>
      <div className="bar">
        <h1 className="grow">Склад залишків</h1>
        <XlButton section="stock" />
        <button type="button" className="btn pri" onClick={() => setModal({ kind: 'edit', x: null })}>
          + На склад
        </button>
      </div>
      <div className="kpis">
        <div className="kpi">
          <small>Позицій на складі</small>
          <b>{active.length}</b>
          <span>
            {active.filter((x) => x.kind === 'Плита').length} обрізків плит · {active.filter((x) => x.kind === 'Стільниця').length} стільниць
          </span>
        </div>
        <div className="kpi">
          <small>Площа обрізків</small>
          <b>{m2(active.reduce((s, x) => s + area1(x) * x.qty, 0))}</b>
          <span>плити і стільниці</span>
        </div>
        <div className="kpi">
          <small>Зарезервовано</small>
          <b>{active.filter((x) => x.status === 'резерв').length}</b>
          <span>під замовлення</span>
        </div>
      </div>
      <div className="sec" style={{ marginBottom: 12, gap: 8 }}>
        <h2>Підібрати обрізок під деталь</h2>
        <div className="bar" style={{ margin: 0 }}>
          <label className="f">
            Ширина, мм
            <input inputMode="numeric" autoComplete="off" value={W} placeholder="1200" style={{ width: 120 }} onChange={(e) => setW(e.target.value)} />
          </label>
          <label className="f">
            Висота, мм
            <input inputMode="numeric" autoComplete="off" value={H} placeholder="600" style={{ width: 120 }} onChange={(e) => setH(e.target.value)} />
          </label>
          <label className="f">
            Товщина
            <select value={thick} onChange={(e) => setThick(e.target.value)}>
              <option value="">будь-яка</option>
              {thicks.map((t) => (
                <option key={t} value={t}>
                  {t} мм
                </option>
              ))}
            </select>
          </label>
          {picking ? (
            <>
              <button type="button" className="btn sm" style={{ alignSelf: 'flex-end' }} onClick={() => (setW(''), setH(''))}>
                Скинути
              </button>
              <span className="muted" style={{ alignSelf: 'flex-end', fontSize: 13 }}>
                Знайдено {rows.length}: від найменшого, що підходить (з поворотом деталі)
              </span>
            </>
          ) : (
            <span className="muted" style={{ alignSelf: 'flex-end', fontSize: 13 }}>
              Вкажіть ширину і висоту деталі — покажемо обрізки, з яких її можна вирізати.
            </span>
          )}
        </div>
      </div>
      <div className="bar">
        <div className="seg">
          {[['', 'Усе'], ...KINDS.map((k) => [k, k])].map(([k, l]) => (
            <button key={k} type="button" aria-current={kind === k} onClick={() => setKind(k!)}>
              {l}
            </button>
          ))}
        </div>
        <input placeholder="Пошук: матеріал, колір, місце" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 180 }} aria-label="Пошук" />
        <label className="chk">
          <input type="checkbox" checked={used} onChange={(e) => setUsed(e.target.checked)} /> Використані
        </label>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Тип</th>
              <th>Матеріал</th>
              <th className="r">Товщ.</th>
              <th className="r">Розмір, мм</th>
              <th className="r">Площа</th>
              <th className="r">К-сть</th>
              <th>Місце</th>
              <th>Звідки</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <RowLink key={x.id} className={x.status === 'використано' ? 'muted' : undefined} onOpen={() => setModal({ kind: 'edit', x })}>
                <td>{x.kind}</td>
                <td>
                  <div>{x.material}</div>
                  {x.note && <small className="muted">{x.note}</small>}
                </td>
                <td className="r num">{x.thick ? `${x.thick} мм` : ''}</td>
                <td className="r num">{isSheet(x.kind) && x.w ? `${x.w} × ${x.h}` : ''}</td>
                <td className="r num">{area1(x) ? m2(area1(x)) : ''}</td>
                <td className="r num">
                  {qtyS(x.qty)} {x.unit}
                </td>
                <td>{x.place}</td>
                <td>
                  <small>
                    {x.fromNum ? `№${x.fromNum} · ${x.fromClient}` : '—'}
                    <br />
                    <span className="muted">
                      {fmtDate(x.createdAt)} · {x.byName}
                    </span>
                  </small>
                </td>
                <td>
                  {x.status === 'резерв' ? (
                    <>
                      <span className="pill g-work">резерв</span>
                      <small className="muted" style={{ display: 'block' }}>
                        №{x.resNum} · {x.resClient}
                      </small>
                    </>
                  ) : x.status === 'використано' ? (
                    <>
                      <span className="pill g-bad">використано</span>
                      {x.resNum && (
                        <small className="muted" style={{ display: 'block' }}>
                          №{x.resNum} · {x.resClient}
                        </small>
                      )}
                    </>
                  ) : (
                    <span className="pill g-done">вільний</span>
                  )}
                </td>
                <td className="r" onClick={(e) => e.stopPropagation()}>
                  {x.status !== 'використано' && (
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      {x.status === 'вільний' ? (
                        <button type="button" className="btn sm" onClick={() => setModal({ kind: 'reserve', x })}>
                          Резерв
                        </button>
                      ) : (
                        <button type="button" className="btn sm" disabled={unres.isPending} onClick={() => unres.mutate(x.id)}>
                          Зняти резерв
                        </button>
                      )}
                      <button type="button" className="btn sm" onClick={() => setModal({ kind: 'use', x })}>
                        Використати
                      </button>
                    </div>
                  )}
                </td>
              </RowLink>
            ))}
          </tbody>
        </table>
        {q.isPending && <div className="empty">Завантаження…</div>}
        {q.isSuccess && !rows.length && <div className="empty">{picking ? 'Немає обрізків, з яких можна вирізати таку деталь.' : 'Нічого не знайдено.'}</div>}
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        Залишки додає цех після збірки. Конструктор підбирає обрізок за розміром і резервує під замовлення; при використанні позиція списується
        (частково або повністю). Ціни тут не ведуться.
      </div>
      {modal?.kind === 'edit' && <StockModal x={modal.x} materials={[...new Set(all.map((y) => y.material))]} onClose={() => setModal(null)} />}
      {(modal?.kind === 'reserve' || modal?.kind === 'use') && <ActModal mode={modal.kind} x={modal.x} onClose={() => setModal(null)} />}
    </>
  );
}

function StockModal({ x, materials, onClose }: { x: StockRow | null; materials: string[]; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const orders = useOrderOptions();
  const [v, setV] = useState({
    kind: x?.kind ?? 'Плита',
    material: x?.material ?? '',
    thick: x?.thick ? String(x.thick) : '18',
    w: x?.w ? String(x.w) : '',
    h: x?.h ? String(x.h) : '',
    qty: x ? qtyS(x.qty) : '1',
    unit: x?.unit ?? 'шт',
    place: x?.place ?? '',
    fromOrderId: x?.fromOrderId ? String(x.fromOrderId) : '',
    note: x?.note ?? '',
  });
  const [err, setErr] = useState('');
  const sheet = isSheet(v.kind);
  const body = () => ({
    kind: v.kind,
    material: v.material,
    thick: sheet ? digits(v.thick) || null : null,
    w: sheet ? digits(v.w) || null : null,
    h: sheet ? digits(v.h) || null : null,
    qty: Number(v.qty.replace(',', '.')) || 0,
    unit: v.unit,
    place: v.place,
    fromOrderId: v.fromOrderId ? Number(v.fromOrderId) : null,
    note: v.note,
  });
  const save = useMutation({
    mutationFn: () => (x ? api.patch(`/stock/${x.id}`, body()) : api.post('/stock', body())),
    onSuccess: () => {
      refresh();
      toast(x ? 'Збережено' : 'Додано на склад');
      onClose();
    },
    onError: (e) => setErr(errorText(e)),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/stock/${x!.id}`),
    onSuccess: () => {
      refresh();
      toast('Видалено');
      onClose();
    },
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal
      onClose={onClose}
      onSubmit={() => {
        if (!v.material.trim()) return setErr('Вкажіть матеріал або найменування.');
        if (sheet && !(digits(v.w) && digits(v.h))) return setErr(v.kind === 'Стільниця' ? 'Для стільниці вкажіть довжину і глибину.' : 'Для плити вкажіть ширину і висоту обрізка.');
        if (!x && !(body().qty > 0)) return setErr('Вкажіть кількість.');
        save.mutate();
      }}
      labelledBy="stock-title"
    >
      <h2 id="stock-title">{x ? 'Позиція складу' : 'На склад'}</h2>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {KINDS.map((k) => (
          <button key={k} type="button" aria-current={v.kind === k} onClick={() => setV({ ...v, kind: k, thick: k === 'Стільниця' && !x ? '38' : v.thick })}>
            {k}
          </button>
        ))}
      </div>
      <label className="f">
        Матеріал / найменування *
        <input
          list="stock-mats"
          value={v.material}
          placeholder={v.kind === 'Стільниця' ? 'Стільниця Egger F186 бетон Чикаго' : sheet ? 'ДСП Egger W1000 білий' : 'Петля Blum Clip top'}
          onChange={(e) => setV({ ...v, material: e.target.value })}
        />
        <datalist id="stock-mats">
          {materials.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <div className="grid">
        {sheet && (
          <>
            <label className="f">
              Товщина, мм
              <input inputMode="numeric" value={v.thick} onChange={(e) => setV({ ...v, thick: e.target.value })} />
            </label>
            <label className="f">
              {v.kind === 'Стільниця' ? 'Довжина' : 'Ширина'}, мм *
              <input inputMode="numeric" value={v.w} onChange={(e) => setV({ ...v, w: e.target.value })} />
            </label>
            <label className="f">
              {v.kind === 'Стільниця' ? 'Глибина' : 'Висота'}, мм *
              <input inputMode="numeric" value={v.h} onChange={(e) => setV({ ...v, h: e.target.value })} />
            </label>
          </>
        )}
        <label className="f">
          Кількість *
          <input inputMode="decimal" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} />
        </label>
        <label className="f">
          Одиниця
          <select value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })}>
            {UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
        <label className="f">
          Місце на складі
          <input value={v.place} placeholder="Стелаж А-1" onChange={(e) => setV({ ...v, place: e.target.value })} />
        </label>
        <label className="f">
          Звідки (замовлення)
          <select value={v.fromOrderId} onChange={(e) => setV({ ...v, fromOrderId: e.target.value })}>
            <option value="">— не з замовлення —</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                №{o.num} · {o.client.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="f">
        Примітка
        <input value={v.note} placeholder="подряпина з одного боку, кромка з двох сторін…" onChange={(e) => setV({ ...v, note: e.target.value })} />
      </label>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        {x && (
          <span style={{ marginRight: 'auto' }}>
            <ConfirmButton disabled={del.isPending} onConfirm={() => del.mutate()}>
              Видалити
            </ConfirmButton>
          </span>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={save.isPending}>
          {x ? 'Зберегти' : 'Додати на склад'}
        </button>
      </div>
    </Modal>
  );
}

function ActModal({ mode, x, onClose }: { mode: 'reserve' | 'use'; x: StockRow; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const orders = useOrderOptions().filter((o) => o.status !== 'Закрито' || o.id === x.resOrderId);
  const [orderId, setOrderId] = useState(x.resOrderId ? String(x.resOrderId) : '');
  const [qty, setQty] = useState(qtyS(x.qty));
  const [err, setErr] = useState('');
  const go = useMutation({
    mutationFn: () =>
      mode === 'reserve'
        ? api.post(`/stock/${x.id}/reserve`, { orderId: Number(orderId) })
        : api.post(`/stock/${x.id}/use`, { qty: Number(qty.replace(',', '.')), orderId: orderId ? Number(orderId) : null }),
    onSuccess: () => {
      refresh();
      toast(mode === 'reserve' ? 'Зарезервовано' : 'Списано');
      onClose();
    },
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal
      onClose={onClose}
      onSubmit={() => {
        if (mode === 'reserve' && !orderId) return setErr('Виберіть замовлення.');
        if (mode === 'use' && !(Number(qty.replace(',', '.')) > 0)) return setErr('Вкажіть кількість.');
        go.mutate();
      }}
      labelledBy="act-title"
    >
      <div className="muted" style={{ fontSize: 12 }}>
        {x.kind} · {x.material}
        {isSheet(x.kind) && x.w ? ` · ${x.w}×${x.h} мм` : ''}
      </div>
      <h2 id="act-title">{mode === 'reserve' ? 'Зарезервувати під замовлення' : 'Використати зі складу'}</h2>
      <label className="f">
        Замовлення{mode === 'reserve' ? ' *' : ''}
        <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">{mode === 'use' ? "— без прив'язки —" : '— виберіть —'}</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              №{o.num} · {o.client.name}
            </option>
          ))}
        </select>
      </label>
      {mode === 'use' && (
        <label className="f">
          Скільки використали (є {qtyS(x.qty)} {x.unit})
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
      )}
      <WarnBox>{err}</WarnBox>
      <div className="act">
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={go.isPending}>
          {mode === 'reserve' ? 'Зарезервувати' : 'Списати'}
        </button>
      </div>
    </Modal>
  );
}
