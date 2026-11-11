import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_METHODS, PAYMENT_TYPES, afterContract, fmtDate, kyivToday, money } from '@vudo/shared';
import { api, errorText } from '../../api';
import type { OfficeCard } from '../../types';
import { WarnBox } from '../../ui/common';
import { useToast } from '../../ui/toast';

/** Вкладка «Оплати»: форма і список. Оплати не видаляються — для коригування «повернення». */
export function PayTab({ o }: { o: OfficeCard }) {
  const qc = useQueryClient();
  const toast = useToast();
  const s = o.sums;
  const blank = () => ({ sum: '', type: afterContract(o.status) ? 'доплата' : 'аванс', method: 'картка', date: kyivToday(), comment: '' });
  const [v, setV] = useState(blank);
  const [err, setErr] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api.post<{ message: string; card: OfficeCard }>(`/orders/${o.id}/payments`, {
        sum: Number(v.sum.replace(',', '.').replace(/\s/g, '')),
        type: v.type,
        method: v.method,
        date: v.date,
        comment: v.comment,
      }),
    onSuccess: (r) => {
      qc.setQueryData(['order', o.id], r.card);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['log'] });
      toast(r.message);
      setV(blank());
      setErr('');
    },
    onError: (e) => setErr(errorText(e)),
  });

  return (
    <>
      <form
        className="sec"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(v.sum.replace(',', '.').replace(/\s/g, ''));
          if (!(n > 0)) return setErr('Вкажіть суму оплати більше 0.');
          if (!v.date) return setErr('Вкажіть дату оплати.');
          add.mutate();
        }}
      >
        <h2>Внести оплату</h2>
        <div className="grid">
          <label className="f">
            Сума, грн *
            <input inputMode="decimal" value={v.sum} placeholder={s.debt > 0 ? String(Math.round(s.debt)) : ''} onChange={(e) => setV({ ...v, sum: e.target.value })} />
          </label>
          <label className="f">
            Тип
            <select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
              {PAYMENT_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="f">
            Спосіб
            <select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
              {PAYMENT_METHODS.map((t) => (
                <option key={t}>{t}</option>
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
        <div>
          <button type="submit" className="btn pri" disabled={add.isPending}>
            Внести оплату
          </button>
        </div>
      </form>
      <div className="sec">
        <h2>Оплати</h2>
        {o.payments.length ? (
          <div className="list">
            {o.payments.map((p) => (
              <div className="li" key={p.id}>
                <div className="m">
                  {p.type} · {p.method}
                  <small>
                    {fmtDate(p.date)} · вніс(ла) {p.byName}
                    {p.comment ? ` · ${p.comment}` : ''}
                  </small>
                </div>
                <b className={`num ${p.type === 'повернення' ? 'debt' : ''}`} style={{ fontWeight: 500 }}>
                  {p.type === 'повернення' ? '−' : ''}
                  {money(p.sum)}
                </b>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">Оплат ще не було.</div>
        )}
        <div className="note num">
          Оплачено {money(s.paid)} з {money(s.price)} · аванс {money(s.avans)} · борг {money(s.debt)}. Оплати не видаляються — для коригування внесіть
          «повернення».
        </div>
      </div>
    </>
  );
}
