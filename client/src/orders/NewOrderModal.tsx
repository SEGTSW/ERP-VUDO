import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CLIENT_TYPES, SOURCES, phoneKey } from '@vudo/shared';
import { api, errorText } from '../api';
import { useMe } from '../session';
import type { ClientFull, ClientRow, OfficeCard } from '../types';
import { Modal, WarnBox } from '../ui/common';
import { useToast } from '../ui/toast';
import { useDrawer } from './hooks';
import { useManagers } from '../pages/Orders';

export const designerLabel = (d: { name: string; company: string | null }) => (d.company ? `${d.name} · ${d.company}` : d.name);

export function useDesigners() {
  return useQuery({ queryKey: ['clients', 'designers', ''], queryFn: () => api.get<ClientRow[]>('/clients?kind=designers') });
}

/** 5.2 Нове звернення: телефон → наявний клієнт або новий; джерело; дизайнер-партнер; менеджер; «Що хоче клієнт». */
export function NewOrderModal({ onClose, client }: { onClose: () => void; client?: ClientFull }) {
  const { user } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const { openOrder } = useDrawer();
  const managers = useManagers();
  const designers = useDesigners().data ?? [];
  const [v, setV] = useState({
    phone: '',
    name: '',
    type: 'фізособа',
    source: (client?.source as string) ?? 'Instagram',
    designer: client?.type === 'дизайнер-партнер' ? String(client.id) : '',
    dName: '',
    dCompany: '',
    dPhone: '',
    managerId: managers.some((m) => m.id === user.id) ? user.id : 0,
    comment: '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Клієнт із таким телефоном уже є — звернення буде додано до нього.
  const key = phoneKey(v.phone);
  const dup = useQuery({
    queryKey: ['client-by-phone', key],
    queryFn: () => api.get<ClientFull | null>(`/clients-by-phone?phone=${encodeURIComponent(v.phone)}`),
    enabled: !client && key.length >= 9,
  });
  const existing = client ?? (key.length >= 9 ? dup.data : null) ?? null;
  useEffect(() => {
    if (existing?.source) setV((x) => ({ ...x, source: existing.source! }));
  }, [existing?.id, existing?.source]);
  useEffect(() => {
    if (!v.managerId && managers[0]) setV((x) => ({ ...x, managerId: managers.some((m) => m.id === user.id) ? user.id : managers[0]!.id }));
  }, [managers, user.id, v.managerId]);

  async function submit() {
    setErr('');
    const body: Record<string, unknown> = { source: v.source, managerId: v.managerId, comment: v.comment };
    if (existing) body.clientId = existing.id;
    else Object.assign(body, { phone: v.phone, name: v.name, type: v.type });
    if (v.source === 'дизайнер') {
      if (v.designer === '__new') {
        if (!v.dName.trim()) return setErr("Вкажіть ім'я нового дизайнера.");
        body.newDesigner = { name: v.dName, company: v.dCompany, phone: v.dPhone };
      } else if (v.designer) body.designerId = Number(v.designer);
    }
    setBusy(true);
    try {
      const card = await api.post<OfficeCard>('/orders', body);
      qc.setQueryData(['order', card.id], card);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['clients'] });
      void qc.invalidateQueries({ queryKey: ['log'] });
      toast(`Звернення №${card.num} створено`);
      onClose();
      openOrder(card.id);
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} onSubmit={submit} labelledBy="new-order-title">
      <h2 id="new-order-title">Нове звернення</h2>
      {client ? (
        <div className="okbox">
          Клієнт: <b>{client.name}</b>
          {client.phone ? `, ${client.phone}` : ''}
        </div>
      ) : (
        <>
          <label className="f">
            Телефон *
            <input inputMode="tel" placeholder="+380 __ ___ __ __" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
          </label>
          {existing ? (
            <div className="okbox">
              Клієнт із таким телефоном уже є: <b>{existing.name}</b>. Звернення буде додано до нього.
            </div>
          ) : (
            <>
              <label className="f">
                ПІБ або назва *
                <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
              </label>
              <label className="f">
                Тип клієнта
                <select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
                  {CLIENT_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </>
          )}
        </>
      )}
      <label className="f">
        Джерело звернення
        <select value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })}>
          {SOURCES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      {v.source === 'дизайнер' && (
        <>
          <label className="f">
            Дизайнер-партнер
            <select value={v.designer} onChange={(e) => setV({ ...v, designer: e.target.value })}>
              <option value="">— не вибрано —</option>
              {designers.map((d) => (
                <option key={d.id} value={d.id}>
                  {designerLabel(d)}
                </option>
              ))}
              <option value="__new">+ Новий дизайнер-партнер…</option>
            </select>
          </label>
          {v.designer === '__new' && (
            <div className="grid">
              <label className="f">
                Ім'я дизайнера *
                <input value={v.dName} onChange={(e) => setV({ ...v, dName: e.target.value })} />
              </label>
              <label className="f">
                Компанія / студія
                <input value={v.dCompany} onChange={(e) => setV({ ...v, dCompany: e.target.value })} />
              </label>
              <label className="f">
                Телефон дизайнера
                <input inputMode="tel" value={v.dPhone} onChange={(e) => setV({ ...v, dPhone: e.target.value })} />
              </label>
            </div>
          )}
        </>
      )}
      <label className="f">
        Менеджер
        <select value={v.managerId} onChange={(e) => setV({ ...v, managerId: Number(e.target.value) })}>
          {managers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <label className="f">
        Що хоче клієнт
        <textarea placeholder="Шафа-купе в нішу 2 м, дзеркальні двері" value={v.comment} onChange={(e) => setV({ ...v, comment: e.target.value })} />
      </label>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={busy}>
          Створити
        </button>
      </div>
    </Modal>
  );
}
