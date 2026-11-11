import { useState } from 'react';
import { COMPONENTS, componentsSum, money, priceDiff, priceFromCost, withMarkup } from '@vudo/shared';
import { api } from '../../api';
import type { OfficeCard, OrderItem } from '../../types';
import { useToast } from '../../ui/toast';
import { useOrderAction } from '../hooks';
import { PriceLine, compInvalid, compToText, textToComp, type CompText } from './ItemsTab';

/** 6.3 Вкладка «Точний прорахунок». */
export function ExactTab({ o }: { o: OfficeCard }) {
  if (!o.items.length) {
    return (
      <div className="sec">
        <div className="empty">Спершу додайте вироби у вкладці «Попередній прорахунок».</div>
      </div>
    );
  }
  const pre = o.items.reduce((t, i) => t + i.calc.prePrice, 0);
  const ex = o.items.reduce((t, i) => t + i.calc.price, 0);
  const done = o.items.filter((i) => i.calc.exactCost != null).length;
  const all = done === o.items.length;
  const d = priceDiff(pre, ex);
  const up = d.diff > 0;
  return (
    <>
      {o.items.map((i) => (
        <ExactItem key={`${i.id}-${JSON.stringify(i.exact)}`} o={o} i={i} />
      ))}
      <div className="vals big">
        <div>
          <small>Попередня вартість</small>
          <b className="num">{money(pre)}</b>
        </div>
        <div className={all ? 'ok' : ''}>
          <small>Точна вартість{!all ? ' (частково)' : ''}</small>
          <b className="num">{done ? money(ex) : '—'}</b>
          <span className="muted">{all ? 'усі вироби прораховано' : `прораховано ${done} з ${o.items.length}`}</span>
        </div>
        <div>
          <small>Різниця</small>
          <b className={`num ${up ? 'debt' : ''}`}>{done ? `${up ? '+' : d.diff < 0 ? '−' : ''}${money(Math.abs(d.diff))}` : '—'}</b>
          {done && d.pct != null && (
            <span className={`num ${up ? 'debt' : ''}`} style={{ fontSize: 15, fontWeight: 600 }}>
              {up ? '+' : d.pct < 0 ? '−' : ''}
              {Math.abs(d.pct).toLocaleString('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
            </span>
          )}
          <span className="muted">{done ? (up ? 'дорожче за попередній' : d.diff < 0 ? 'дешевше за попередній' : 'без змін') : ''}</span>
        </div>
      </div>
      <PriceLine o={o} />
      <div className="note">
        Точні суми вносяться після конструктиву (за деталюванням і рахунками постачальників). Коли виріб прораховано точно, ціна і собівартість
        замовлення беруться з точного прорахунку; поки ні — з попереднього.
        {o.contractPrice != null ? ` Ціна в договорі зафіксована: ${money(o.contractPrice)}.` : ''}
      </div>
    </>
  );
}

function ExactItem({ o, i }: { o: OfficeCard; i: OrderItem }) {
  const toast = useToast();
  const [t, setT] = useState<CompText>(compToText(i.exact));
  const save = useOrderAction(
    o.id,
    (exact: ReturnType<typeof textToComp>) => api.put<OfficeCard>(`/orders/${o.id}/items/${i.id}/exact`, { exact }),
    (exact) => (Object.keys(exact).length ? 'Точний прорахунок збережено' : 'Точний прорахунок очищено'),
  );
  // Розрахунок під час введення — з поточною націнкою (вона зафіксується при збереженні)
  const cost = componentsSum(textToComp(t));
  const dp = i.designerPct ?? 0;
  const preMk = withMarkup(i.calc.preCost, i.markupPct);
  return (
    <div className="sec exact">
      <div className="hd">
        <h2>
          {i.name}{' '}
          <small className="muted" style={{ fontWeight: 400 }}>
            · {i.type}
          </small>
        </h2>
        {i.calc.exactCost != null ? <span className="pill g-done">прораховано</span> : <span className="pill g-work">ще попередньо</span>}
      </div>
      <div className="grid">
        {COMPONENTS.map(([k, l]) => (
          <label className="f" key={k}>
            {l}
            <input inputMode="decimal" value={t[k] ?? ''} placeholder={i.pre[k] ? `попер. ${i.pre[k]}` : '0'} onChange={(e) => setT({ ...t, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="cmp">
        <div>
          <small>Собівартість</small>
          <span className="num muted">попер. {money(i.calc.preCost)}</span>
          <b className="num">{cost ? money(cost) : '—'}</b>
        </div>
        <div>
          <small>З націнкою {o.markupPct}%</small>
          <span className="num muted">попер. {money(preMk)}</span>
          <b className="num">{cost ? money(withMarkup(cost, o.markupPct)) : '—'}</b>
        </div>
        <div>
          <small>Точна вартість{dp ? ` (+${dp}% дизайнеру)` : ''}</small>
          <span className="num muted">попер. {money(i.calc.prePrice)}</span>
          <b className="num costfin">{cost ? money(priceFromCost(cost, o.markupPct, dp)) : '—'}</b>
        </div>
      </div>
      <div className="act">
        <button type="button" className="btn sm" onClick={() => setT(compToText(i.pre))}>
          Скопіювати з попереднього
        </button>
        <button
          type="button"
          className="btn sm pri"
          disabled={save.isPending}
          onClick={() => (compInvalid(t) ? toast('Суми компонентів — числа, не менше 0.', true) : save.mutate(textToComp(t)))}
        >
          Зберегти точний прорахунок
        </button>
      </div>
    </div>
  );
}
