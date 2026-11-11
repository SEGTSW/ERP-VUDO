import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fmtDateTime, isOffice } from '@vudo/shared';
import { api, errorText } from '../api';
import { useMe } from '../session';
import type { Issue, ReservedStock } from '../types';
import { Modal, WarnBox } from '../ui/common';
import { useToast } from '../ui/toast';

function useRefreshOrder() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['order', 'orders', 'log', 'myday']) void qc.invalidateQueries({ queryKey: [k] });
  };
}

/** Список відкритих проблем: нове (червоне) → замовлено (жовте). Кнопки «Замовлено» / «Вирішено» — лише менеджер і власник. */
export function IssuesList({ issues }: { issues: Issue[] }) {
  const { user } = useMe();
  const boss = isOffice(user);
  const toast = useToast();
  const refresh = useRefreshOrder();
  const set = useMutation({
    mutationFn: (v: { id: number; status: 'замовлено' | 'вирішено' }) => api.patch(`/issues/${v.id}`, { status: v.status }),
    onSuccess: (_r, v) => {
      refresh();
      toast(v.status === 'замовлено' ? 'Позначено: дозамовлено' : 'Позначено: вирішено');
    },
    onError: (e) => toast(errorText(e), true),
  });
  if (!issues.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {issues.map((x) => (
        <div key={x.id} className={`issue ${x.status === 'замовлено' ? 'ordered' : ''}`}>
          {x.photoId && (
            <a href={`/api/files/${x.photoId}`} target="_blank" rel="noreferrer">
              <img src={`/api/files/${x.photoId}`} alt="Фото" />
            </a>
          )}
          <div className="m">
            <b>
              {x.type}
              {x.urgent ? ' · зупиняє роботу' : ''}
            </b>
            : {x.text}
            {x.qty ? ` — ${x.qty}` : ''}
            <small>
              {x.itemName ? `${x.itemName} · ` : ''}
              {x.byName} · {fmtDateTime(x.createdAt)} · {x.status === 'замовлено' ? 'дозамовлено, чекаємо' : 'нове, треба дозамовити'}
            </small>
          </div>
          {boss && (
            <div style={{ display: 'flex', gap: 4, flexDirection: 'column' }}>
              {x.status === 'нове' && (
                <button type="button" className="btn sm" disabled={set.isPending} onClick={() => set.mutate({ id: x.id, status: 'замовлено' })}>
                  Замовлено
                </button>
              )}
              <button type="button" className="btn sm" disabled={set.isPending} onClick={() => set.mutate({ id: x.id, status: 'вирішено' })}>
                Вирішено
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Блоки над сумами в картці: «Брак і нестачі (N)» і «Зі складу зарезервовано (N)». */
export function OrderTopBlocks({ issues, reserved }: { issues: Issue[]; reserved: ReservedStock[] }) {
  return (
    <>
      {!!issues.length && (
        <div className="sec" style={{ gap: 8 }}>
          <h2>Брак і нестачі ({issues.length})</h2>
          <IssuesList issues={issues} />
        </div>
      )}
      {!!reserved.length && (
        <div className="sec" style={{ gap: 6 }}>
          <h2>Зі складу зарезервовано ({reserved.length})</h2>
          {reserved.map((x) => (
            <div key={x.id} className="muted" style={{ fontSize: 13 }}>
              {x.kind} · <b style={{ color: 'var(--fg)', fontWeight: 500 }}>{x.material}</b>
              {x.w ? ` · ${x.w}×${x.h}${x.thick ? `×${x.thick}` : ''} мм` : ''} · {String(x.qty).replace('.', ',')} {x.unit}
              {x.place ? ` · ${x.place}` : ''}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Форма «Не вистачає / брак деталі». На телефоні поле фото відкриває камеру. */
export function IssueModal({
  orderId,
  num,
  clientName,
  items,
  itemId,
  onClose,
}: {
  orderId: number;
  num: string;
  clientName: string;
  items: { id: number; name: string }[];
  itemId?: number;
  onClose: () => void;
}) {
  const toast = useToast();
  const refresh = useRefreshOrder();
  const [type, setType] = useState<'Не вистачає' | 'Брак деталі'>('Не вистачає');
  const [item, setItem] = useState(itemId ? String(itemId) : '');
  const [qty, setQty] = useState('');
  const [text, setText] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [err, setErr] = useState('');
  const send = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.append('type', type);
      f.append('itemId', item);
      f.append('qty', qty);
      f.append('text', text);
      f.append('urgent', String(urgent));
      if (photo) f.append('photo', photo, photo.name);
      return api.upload(`/orders/${orderId}/issues`, f);
    },
    onSuccess: () => {
      refresh();
      toast('Надіслано менеджеру');
      onClose();
    },
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal onClose={onClose} onSubmit={() => (text.trim() ? send.mutate() : setErr('Опишіть, чого не вистачає або що за брак.'))} labelledBy="issue-title">
      <div className="muted" style={{ fontSize: 12 }}>
        №{num} · {clientName}
      </div>
      <h2 id="issue-title">Не вистачає / брак деталі</h2>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {(['Не вистачає', 'Брак деталі'] as const).map((k) => (
          <button key={k} type="button" aria-current={type === k} onClick={() => setType(k)}>
            {k}
          </button>
        ))}
      </div>
      <div className="grid">
        <label className="f">
          Виріб
          <select value={item} onChange={(e) => setItem(e.target.value)}>
            <option value="">— усе замовлення —</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="f">
          Кількість
          <input value={qty} placeholder="напр. 2 шт, 1 лист" onChange={(e) => setQty(e.target.value)} />
        </label>
      </div>
      <label className="f">
        Що саме *
        <textarea value={text} placeholder={type === 'Брак деталі' ? 'Фасад 716×396, скол на крайці' : 'Петлі Blum з доводчиком, 4 шт'} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="f">
        Фото
        <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </label>
      <label className="chk">
        <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Зупиняє роботу (терміново)
      </label>
      <div className="note">Менеджер одразу отримає повідомлення (папка «Брак і нестачі») і позначить «Замовлено», коли дозамовить.</div>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={send.isPending}>
          Надіслати менеджеру
        </button>
      </div>
    </Modal>
  );
}
