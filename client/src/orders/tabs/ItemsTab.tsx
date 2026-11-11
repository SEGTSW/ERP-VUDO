import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { COMPONENTS, ITEM_TYPES, afterContract, componentsSum, money, priceFromCost, withMarkup, type Components } from '@vudo/shared';
import { api, errorText } from '../../api';
import type { OfficeCard, OrderItem } from '../../types';
import { ConfirmButton, Modal, WarnBox } from '../../ui/common';
import { useToast } from '../../ui/toast';

const plain = (n: number) => money(n).replace(/\s?грн$/, '');

/** Рядок «Ціна замовлення = вироби + доставка − знижка», якщо є доставка або знижка. */
export function PriceLine({ o }: { o: OfficeCard }) {
  if (!(o.delivery > 0) && !(o.sums.discount > 0)) return null;
  return (
    <div className="note num" style={{ marginTop: 10 }}>
      Ціна замовлення = вироби {money(o.sums.items)}
      {o.delivery > 0 ? ` + доставка ${money(o.delivery)}` : ''}
      {o.sums.discount > 0 ? ` − знижка ${money(o.sums.discount)}` : ''} = <b>{money(o.sums.price)}</b>. Доставка і знижка змінюються у вкладці «Загальне».
    </div>
  );
}

/** Три плашки: попередня вартість, точна вартість і (тут) кнопка «Точний прорахунок →». */
function Totals({ o, onExact }: { o: OfficeCard; onExact: () => void }) {
  const pre = o.items.reduce((t, i) => t + i.calc.prePrice, 0);
  const ex = o.items.reduce((t, i) => t + i.calc.price, 0);
  const done = o.items.filter((i) => i.calc.exactCost != null).length;
  const all = done === o.items.length;
  return (
    <div className="vals">
      <div>
        <small>Попередня вартість</small>
        <b className="num">{money(pre)}</b>
      </div>
      <div className={all ? 'ok' : ''}>
        <small>Точна вартість</small>
        <b className="num">{done ? money(ex) : '—'}</b>
        <span className="muted">{all ? 'прораховано всі вироби' : done ? `прораховано ${done} з ${o.items.length}, решта — попередньо` : 'ще не прораховано'}</span>
      </div>
      <button type="button" className="btn sm" onClick={onExact}>
        Точний прорахунок →
      </button>
    </div>
  );
}

/** 6.1 Вкладка «Попередній прорахунок». */
export function ItemsTab({ o, onExact }: { o: OfficeCard; onExact: () => void }) {
  const [edit, setEdit] = useState<OrderItem | 'new' | null>(null);
  return (
    <div className="sec">
      <div className="hd">
        <h2>Попередній прорахунок</h2>
        <button type="button" className="btn sm pri" onClick={() => setEdit('new')}>
          + Виріб
        </button>
      </div>
      {o.items.length ? (
        <div className="list">
          {o.items.map((i) => {
            const nz = COMPONENTS.filter(([k]) => (i.pre[k] ?? 0) > 0);
            return (
              <div className="li" key={i.id} style={{ cursor: 'pointer' }} tabIndex={0} onClick={() => setEdit(i)} onKeyDown={(e) => e.key === 'Enter' && setEdit(i)}>
                <div className="m">
                  <b style={{ fontWeight: 600 }}>{i.name}</b> <span className="muted">· {i.type}</span>
                  {!!nz.length && <small className="num">{nz.map(([k, l]) => `${l} ${plain(i.pre[k]!)}`).join(' · ')}</small>}
                  {i.calc.preCost > 0 && (
                    <small className="num">
                      собівартість {money(i.calc.preCost)} · з націнкою {money(withMarkup(i.calc.preCost, i.markupPct))}
                      {i.designerPct ? ` · з дизайнером (${i.designerPct}%) ${money(i.calc.prePrice)}` : ''}
                    </small>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="num">{i.calc.prePrice ? money(i.calc.prePrice) : <span className="debt">без ціни</span>}</div>
                  <small>попередньо</small>
                  {i.calc.exactPrice != null && <small className="num st-ok">точно {money(i.calc.exactPrice)}</small>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">Виробів ще немає. Додайте шафу, кухню чи інший виріб із прорахунком.</div>
      )}
      {!!o.items.length && <Totals o={o} onExact={onExact} />}
      <PriceLine o={o} />
      <div className="note">
        Попередній прорахунок: корпус + фасади + стільниця + фурнітура + підсвітка + профіль = собівартість; ціна для клієнта = собівартість × (1 +
        націнка) × (1 + % дизайнера). Після конструктиву внесіть точні суми у вкладці «Точний прорахунок» — ціна замовлення візьметься з них.
      </div>
      {edit && <ItemModal o={o} item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

/** Поля компонентів собівартості (крок 10). Значення — рядки, щоб не скидати введене під час набору. */
export type CompText = Partial<Record<(typeof COMPONENTS)[number][0], string>>;
export const compToText = (c: Components | null | undefined): CompText =>
  Object.fromEntries(COMPONENTS.map(([k]) => [k, c?.[k] ? String(c[k]) : ''])) as CompText;
export const textToComp = (t: CompText): Components => {
  const out: Components = {};
  for (const [k] of COMPONENTS) {
    const v = Number(String(t[k] ?? '').replace(',', '.').replace(/\s/g, ''));
    if (Number.isFinite(v) && v > 0) out[k] = Math.round(v * 100) / 100;
  }
  return out;
};
export const compInvalid = (t: CompText) =>
  COMPONENTS.some(([k]) => {
    const s = String(t[k] ?? '').trim();
    return s !== '' && !(Number(s.replace(',', '.').replace(/\s/g, '')) >= 0);
  });

/** 6.2 Форма виробу: компоненти → собівартість → з нашою націнкою → дизайнер бере % → ціна. */
function ItemModal({ o, item, onClose }: { o: OfficeCard; item: OrderItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(item?.name ?? '');
  const [type, setType] = useState(item?.type ?? 'шафа-купе');
  const [desc, setDesc] = useState(item?.description ?? '');
  const [comps, setComps] = useState<CompText>(compToText(item?.pre));
  const defaultDp = item ? item.designerPct : o.source === 'дизайнер' && o.designer ? o.designer.bonusPct : null;
  const [dp, setDp] = useState(defaultDp != null ? String(defaultDp) : '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Націнка: при збереженні фіксується поточна з налаштувань
  const markup = o.markupPct;
  const cost = componentsSum(textToComp(comps));
  const dpNum = Number(dp.replace(',', '.')) || 0;
  const mk = withMarkup(cost, markup);
  const price = priceFromCost(cost, markup, dpNum);
  const locked = afterContract(o.status) || !!o.contractDate;

  const done = (card: OfficeCard, msg: string) => {
    qc.setQueryData(['order', o.id], card);
    void qc.invalidateQueries({ queryKey: ['orders'] });
    void qc.invalidateQueries({ queryKey: ['log'] });
    toast(msg);
    onClose();
  };

  async function submit() {
    if (!name.trim()) return setErr('Вкажіть назву виробу.');
    if (compInvalid(comps)) return setErr('Суми компонентів — числа, не менше 0.');
    if (dp.trim() && !(dpNum >= 0 && dpNum <= 100)) return setErr('«Дизайнер бере з нас» — від 0 до 100 %.');
    const body = { name, type, description: desc, pre: textToComp(comps), designerPct: dp.trim() ? dpNum : null };
    setBusy(true);
    try {
      const card = item ? await api.patch<OfficeCard>(`/orders/${o.id}/items/${item.id}`, body) : await api.post<OfficeCard>(`/orders/${o.id}/items`, body);
      done(card, item ? 'Виріб збережено' : 'Виріб додано, створено план етапів');
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      done(await api.del<OfficeCard>(`/orders/${o.id}/items/${item!.id}`), 'Виріб прибрано');
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} onSubmit={submit} labelledBy="item-title">
      <h2 id="item-title">{item ? 'Виріб' : 'Новий виріб'}</h2>
      <div className="grid">
        <label className="f">
          Назва *
          <input value={name} placeholder="Шафа-купе в спальню" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="f">
          Тип
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {ITEM_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="costbox">
        <div className="hd">
          <h3>Попередній прорахунок, грн</h3>
        </div>
        <div className="grid">
          {COMPONENTS.map(([k, l]) => (
            <label className="f" key={k}>
              <span>
                {l}
                {k === 'top' && <span style={{ fontSize: 11 }}> (якщо треба)</span>}
              </span>
              <input inputMode="decimal" placeholder="0" value={comps[k] ?? ''} onChange={(e) => setComps({ ...comps, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="costtot">
          <span>Собівартість</span>
          <b className="num">{money(cost)}</b>
        </div>
        <div className="costrow">
          <span>
            З нашою націнкою <small className="muted">({markup}%, робота і монтаж)</small>
          </span>
          <b className="num">{money(mk)}</b>
        </div>
        <div className="grid">
          <label className="f">
            Дизайнер бере з нас, %
            <input inputMode="decimal" placeholder="0" value={dp} onChange={(e) => setDp(e.target.value)} />
          </label>
          <div className="f" style={{ justifyContent: 'flex-end' }}>
            <span>Ціна для клієнта (попередня)</span>
            <b className="num costfin">{money(price)}</b>
          </div>
        </div>
        {item?.calc.exactPrice != null && (
          <div className="okbox">
            Є точний прорахунок: точна вартість <b className="num">{money(item.calc.exactPrice)}</b>. Ціна замовлення береться з нього.
          </div>
        )}
        {item && item.markupPct !== markup && (
          <div className="note">
            Виріб пораховано з націнкою {item.markupPct}%. Після збереження застосується поточна націнка з налаштувань — {markup}%.
          </div>
        )}
      </div>
      <label className="f">
        Опис / наповнення
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
      </label>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        {item && (
          <span style={{ marginRight: 'auto' }}>
            {locked ? (
              <button type="button" className="btn warn" onClick={() => setErr('Після договору вироби не прибираються — змініть дані виробу або додайте коментар.')}>
                Прибрати виріб
              </button>
            ) : (
              <ConfirmButton disabled={busy} onConfirm={remove}>
                Прибрати виріб
              </ConfirmButton>
            )}
          </span>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={busy}>
          Зберегти
        </button>
      </div>
    </Modal>
  );
}
