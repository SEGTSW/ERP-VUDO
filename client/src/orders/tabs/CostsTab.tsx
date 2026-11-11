import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { fmtDate, fmtDateTime, money } from '@vudo/shared';
import { api, errorText } from '../../api';
import { CashModal, useRefreshFinance, type CashRow } from '../../finance/CashModal';
import { useToast } from '../../ui/toast';

export interface Costs {
  fact: number;
  materials: number;
  collab: number;
  byCat: { cat: string; sum: number }[];
  plan: number;
  left: number;
  opex: number | null;
  opexPct: number;
  opexAutoValue: number;
  price: number;
  figures: {
    opex: number;
    netProfit: number;
    netPct: number;
    netCost: number;
    netCostSrc: string;
    netDesigner: number;
    netDesignerSrc: string;
  };
  rows: CashRow[];
}

export const useCosts = (orderId: number, enabled: boolean) =>
  useQuery({ queryKey: ['finance', 'costs', orderId], queryFn: () => api.get<Costs>(`/finance/orders/${orderId}/costs`), enabled });

/** 5.4 Вкладка «Витрати» (лише власник): факт, план, залишилось, постійні витрати, чистий прибуток з розшифровкою. */
export function CostsTab({ orderId }: { orderId: number }) {
  const toast = useToast();
  const refresh = useRefreshFinance();
  const q = useCosts(orderId, true);
  const [modal, setModal] = useState<{ edit?: CashRow } | null>(null);
  const [opex, setOpex] = useState<string | null>(null);
  const saveOpex = useMutation({
    mutationFn: (v: number | null) => api.patch(`/finance/orders/${orderId}/opex`, { opex: v }),
    onSuccess: () => {
      refresh();
      setOpex(null);
      toast('Збережено');
    },
    onError: (e) => toast(errorText(e), true),
  });
  const c = q.data;
  if (q.isPending) return <div className="sec">Завантаження…</div>;
  if (!c) return <div className="sec warnbox">Не вдалося завантажити витрати.</div>;
  const f = c.figures;
  const over = c.materials > c.plan && c.plan > 0;
  const opexText = opex ?? (c.opex != null ? String(c.opex) : '');
  return (
    <>
      <div className="sec">
        <div className="hd">
          <h2>Витрати на замовлення</h2>
          <button type="button" className="btn sm pri" onClick={() => setModal({})}>
            + Витрата
          </button>
        </div>
        <div className="sums">
          <div>
            <small>Фактичні витрати</small>
            <b>{money(c.fact)}</b>
          </div>
          <div>
            <small>План (собівартість)</small>
            <b>{money(c.plan)}</b>
          </div>
          <div>
            <small>Залишилось витратити</small>
            <b className={over ? 'debt' : ''}>{c.plan ? (over ? `перевитрата ${money(c.materials - c.plan)}` : money(c.plan - c.materials)) : '—'}</b>
            <span className="muted" style={{ fontSize: 11.5 }}>
              матеріали без «Співпраць»: {money(c.materials)}
            </span>
          </div>
        </div>
        {!!c.byCat.length && (
          <div className="muted num" style={{ fontSize: 12 }}>
            {c.byCat.map((x) => `${x.cat} ${money(x.sum)}`).join(' · ')}
          </div>
        )}
        <div className="grid">
          <label className="f">
            Постійні (операційні) витрати, грн
            <input
              inputMode="decimal"
              value={opexText}
              placeholder={`${c.opexAutoValue} (авто: ${c.opexPct}% від ціни)`}
              onChange={(e) => setOpex(e.target.value)}
            />
          </label>
          <div className="f" style={{ justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn sm"
              disabled={saveOpex.isPending}
              onClick={() => {
                const t = opexText.trim().replace(',', '.').replace(/\s/g, '');
                if (t && !(Number(t) >= 0)) return toast('Вкажіть суму, не менше 0.', true);
                saveOpex.mutate(t ? Number(t) : null);
              }}
            >
              Зберегти
            </button>
          </div>
        </div>
        <div className="profit">
          <span>Чистий прибуток замовлення (наш)</span>
          <b className={`num ${f.netProfit < 0 ? 'debt' : ''}`}>
            {money(f.netProfit)} <small style={{ fontSize: 14 }}>{c.price ? `${Math.round(f.netPct * 10) / 10}%` : ''}</small>
          </b>
          <table className="pbr num">
            <tbody>
              <tr>
                <td>Ціна замовлення</td>
                <td className="r">{money(c.price)}</td>
              </tr>
              <tr>
                <td>
                  − Собівартість <small className="muted">({f.netCostSrc})</small>
                </td>
                <td className="r">{money(f.netCost)}</td>
              </tr>
              {f.netDesigner > 0 && (
                <tr>
                  <td>
                    − Дизайнер <small className="muted">({f.netDesignerSrc})</small>
                  </td>
                  <td className="r">{money(f.netDesigner)}</td>
                </tr>
              )}
              <tr>
                <td>− Постійні витрати</td>
                <td className="r">{money(f.opex)}</td>
              </tr>
              <tr className="tot">
                <td>= Чистий прибуток</td>
                <td className="r">{money(f.netProfit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="sec">
        <h2>Операції по замовленню</h2>
        {c.rows.length ? (
          <div className="list">
            {c.rows.map((e) => (
              <div className="li" key={e.key}>
                <div className="m">
                  {e.cat}
                  {e.note ? ` · ${e.note}` : ''}
                  <small>
                    {fmtDate(e.date)} · {e.counterparty} · {e.account}
                    {e.updatedAt ? ` · змінено ${fmtDateTime(e.updatedAt)}, ${e.updatedByName}` : ''}
                  </small>
                </div>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <b className={`num ${e.sum < 0 ? 'debt' : ''}`} style={{ fontWeight: 500 }}>
                    {money(e.sum)}
                  </b>
                  <button type="button" className="mini" onClick={() => setModal({ edit: e })}>
                    Змінити
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">Витрат ще немає. Додайте матеріали, фурнітуру, доставку — вони потраплять і в облік.</div>
        )}
        <div className="note">
          Витрати, додані тут, записуються в облік (Фінанси → Облік) з прив'язкою до замовлення. Постійні витрати — частка оренди, зарплат, реклами
          тощо, яку несе це замовлення; якщо поле порожнє, береться {c.opexPct}% від ціни.
        </div>
      </div>
      {modal && <CashModal edit={modal.edit} lockOrderId={modal.edit ? undefined : orderId} onClose={() => setModal(null)} />}
    </>
  );
}
