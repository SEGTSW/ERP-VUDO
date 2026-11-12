import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACCOUNTS, ART_TYPES, findArticle, kyivToday, lineLabel, typeSign } from '@vudo/shared';
import { api, errorText } from '../api';
import type { OrderListItem } from '../types';
import { Modal, WarnBox } from '../ui/common';
import { useToast } from '../ui/toast';

export interface ArticleRow {
  id: number;
  type: string;
  cat: string;
  obj: string;
  defaultCp: string;
  line: string;
  toOrder: boolean;
  hidden: boolean;
  ops: number;
}

export interface CashRow {
  key: string;
  opId: number | null;
  date: string;
  type: string;
  cat: string;
  obj: string;
  orderId: number | null;
  counterparty: string;
  note: string;
  account: 'Карта' | 'Готівка';
  sum: number;
  line: string;
  derived: null | 'оплата' | 'дизайнер';
  updatedAt: string | null;
  updatedByName: string | null;
}

export const useArticles = () => useQuery({ queryKey: ['finance', 'articles'], queryFn: () => api.get<ArticleRow[]>('/finance/articles') });

export function useRefreshFinance() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['finance', 'order', 'orders', 'log']) void qc.invalidateQueries({ queryKey: [k] });
  };
}

/**
 * Вікно операції обліку: «Нова операція» / «Витрата на замовлення» (стаття і замовлення зафіксовані) / «Редагувати операцію».
 * Сума без мінуса — знак визначає стаття.
 */
export interface CashPrefill {
  cat: string;
  obj: string;
  amount: number;
  note: string;
  counterparty: string;
  fixedId: number;
}

export function CashModal({ edit, lockOrderId, prefill, onClose }: { edit?: CashRow; lockOrderId?: number; prefill?: CashPrefill; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefreshFinance();
  const arts = (useArticles().data ?? []).filter((a) => !a.hidden);
  const orders = useQuery({ queryKey: ['orders', 'options-all'], queryFn: () => api.get<OrderListItem[]>('/orders') }).data ?? [];
  const [v, setV] = useState({
    date: edit?.date ?? kyivToday(),
    type: edit?.type ?? 'Витрата',
    cat: edit?.cat ?? prefill?.cat ?? (lockOrderId ? 'Замовлення' : ''),
    obj: edit && !edit.orderId ? edit.obj : (prefill?.obj ?? ''),
    orderId: edit?.orderId ?? lockOrderId ?? null,
    counterparty: edit?.counterparty ?? prefill?.counterparty ?? '',
    note: edit?.note ?? prefill?.note ?? '',
    account: edit?.account ?? 'Карта',
    amount: edit ? String(Math.abs(edit.sum)) : prefill ? String(prefill.amount) : '',
  });
  const [err, setErr] = useState('');
  const ofType = arts.filter((a) => a.type === v.type);
  const cats = [...new Set(ofType.map((a) => a.cat))];
  const cat = cats.includes(v.cat) ? v.cat : (cats[0] ?? '');
  const toOrder = ofType.some((a) => a.cat === cat && a.toOrder);
  const objs = ofType.filter((a) => a.cat === cat && a.obj).map((a) => a.obj);
  const art = findArticle(arts, v.type, cat, v.obj);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        date: v.date,
        type: v.type,
        cat,
        obj: toOrder ? '' : v.obj,
        orderId: toOrder ? v.orderId : null,
        counterparty: v.counterparty,
        note: v.note,
        account: v.account,
        amount: Number(v.amount.replace(',', '.').replace(/\s/g, '')),
        ...(prefill && !edit ? { fixedId: prefill.fixedId } : {}),
      };
      return edit ? api.patch(`/finance/cash/${edit.opId}`, body) : api.post('/finance/cash', body);
    },
    onSuccess: () => {
      refresh();
      toast(edit ? 'Зміни збережено' : 'Операцію записано');
      onClose();
    },
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal
      onClose={onClose}
      onSubmit={() => {
        if (!(Number(v.amount.replace(',', '.').replace(/\s/g, '')) > 0)) return setErr('Вкажіть суму більше 0.');
        if (toOrder && !v.orderId) return setErr('Виберіть замовлення.');
        save.mutate();
      }}
      labelledBy="cash-title"
    >
      <h2 id="cash-title">{edit ? 'Редагувати операцію' : lockOrderId ? 'Витрата на замовлення' : 'Нова операція'}</h2>
      {edit && <div className="note">Зміни буде записано в «Повідомлення» та історію замовлення.</div>}
      <div className="grid">
        <label className="f">
          Дата
          <input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        </label>
        <label className="f">
          Стаття
          <select value={v.type} disabled={!!lockOrderId} onChange={(e) => setV({ ...v, type: e.target.value, cat: '' })}>
            {ART_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="f">
          Підстаття
          <select value={cat} onChange={(e) => setV({ ...v, cat: e.target.value, obj: '' })}>
            {cats.map((c) => (
              <option key={c} value={c}>
                {c || '—'}
              </option>
            ))}
          </select>
        </label>
        {toOrder ? (
          <label className="f">
            Замовлення *
            <select value={v.orderId ?? ''} disabled={!!lockOrderId} onChange={(e) => setV({ ...v, orderId: Number(e.target.value) || null })}>
              <option value="">— виберіть —</option>
              {orders
                .filter((o) => o.status !== 'Відмова' || o.id === v.orderId)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    №{o.num} · {o.client.name}
                  </option>
                ))}
            </select>
          </label>
        ) : (
          <label className="f">
            Об'єкт
            <input list="cash-objs" value={v.obj} onChange={(e) => setV({ ...v, obj: e.target.value })} />
            <datalist id="cash-objs">
              {objs.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </label>
        )}
        <label className="f">
          Контрагент
          <input value={v.counterparty} placeholder={art?.defaultCp || 'VUDO'} onChange={(e) => setV({ ...v, counterparty: e.target.value })} />
        </label>
        <label className="f">
          Сума, грн *
          <input inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
        </label>
        <label className="f">
          Каса
          <select value={v.account} onChange={(e) => setV({ ...v, account: e.target.value as 'Карта' | 'Готівка' })}>
            {ACCOUNTS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="f">
        Примітка
        <input value={v.note} placeholder="напр.: ДСП Віяр, реклама ФБ" onChange={(e) => setV({ ...v, note: e.target.value })} />
      </label>
      <div className="note">
        Рядок P&L: <b>{lineLabel(art?.line ?? 'none')}</b>
        {toOrder ? ' · піде у фактичні витрати замовлення' : ''}. Суму вводьте без мінуса — знак визначає стаття
        {typeSign(v.type) < 0 ? ' (буде мінус)' : ''}.
      </div>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={save.isPending}>
          {edit ? 'Зберегти зміни' : 'Записати'}
        </button>
      </div>
    </Modal>
  );
}
