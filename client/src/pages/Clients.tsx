import { useDeferredValue, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CLIENT_TYPES, SOURCES, money } from '@vudo/shared';
import { api, errorText } from '../api';
import type { ClientCard, ClientFull, ClientRow } from '../types';
import { useDrawer } from '../orders/hooks';
import { NewOrderModal } from '../orders/NewOrderModal';
import { ConfirmButton, Modal, WarnBox } from '../ui/common';
import { Drawer, RowLink, StatusPill, SubTabs, XlButton } from '../ui/bits';
import { useToast } from '../ui/toast';

const DESIGNER = 'дизайнер-партнер';

function useSettingsPct() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ designerPct: number }>('/settings') });
  return q.data?.designerPct ?? 10;
}

/** Після змін у клієнтах оновити всі пов'язані списки. */
function useInvalidateClients() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['clients'] });
    void qc.invalidateQueries({ queryKey: ['client'] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
    void qc.invalidateQueries({ queryKey: ['order'] });
    void qc.invalidateQueries({ queryKey: ['log'] });
  };
}

/** 9. Клієнти і 9.1 Дизайнери-партнери. */
export function Clients() {
  const [tab, setTab] = useState<'cl' | 'des'>('cl');
  const [text, setText] = useState('');
  const [archived, setArchived] = useState(false);
  const [modal, setModal] = useState<'client' | 'designer' | null>(null);
  const [editDes, setEditDes] = useState<number | null>(null);
  const { openClient } = useDrawer();
  const q = useDeferredValue(text);
  const kind = tab === 'des' ? 'designers' : 'clients';
  const list = useQuery({
    queryKey: ['clients', kind, q, archived],
    queryFn: () => api.get<ClientRow[]>(`/clients?${new URLSearchParams({ kind, q, archived: archived ? '1' : '0' })}`),
  });
  const desCount = useQuery({ queryKey: ['clients', 'designers', ''], queryFn: () => api.get<ClientRow[]>('/clients?kind=designers') });
  const pct = useSettingsPct();
  const rows = list.data ?? [];

  return (
    <>
      <div className="bar">
        <h1 className="grow">Клієнти</h1>
        <XlButton section={tab === 'des' ? 'designers' : 'clients'} params={{ archived: archived ? 1 : 0 }} />
        {tab === 'cl' ? (
          <button type="button" className="btn pri" onClick={() => setModal('client')}>
            + Новий клієнт
          </button>
        ) : (
          <button type="button" className="btn pri" onClick={() => setModal('designer')}>
            + Дизайнер-партнер
          </button>
        )}
      </div>
      <div style={{ marginBottom: 14 }}>
        <SubTabs
          tabs={[
            ['cl', 'Клієнти'],
            ['des', `Дизайнери-партнери (${desCount.data?.length ?? 0})`],
          ]}
          cur={tab}
          onChange={(t) => {
            setTab(t);
            setText('');
          }}
        />
      </div>
      <div className="bar">
        <input
          placeholder={tab === 'des' ? "Пошук: ім'я, компанія або телефон" : 'Пошук: ПІБ або телефон'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
          aria-label="Пошук"
        />
        <label className="chk">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Архів
        </label>
      </div>
      <div className="tbl-wrap">
        {tab === 'cl' ? (
          <table>
            <thead>
              <tr>
                <th>Клієнт</th>
                <th>Тип</th>
                <th>Телефон</th>
                <th>Джерело</th>
                <th className="r">Замовлень</th>
                <th className="r">Сума покупок</th>
                <th className="r">Борг</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <RowLink key={c.id} onOpen={() => openClient(c.id)}>
                  <td>{c.name}</td>
                  <td>{c.type}</td>
                  <td className="num">{c.phone}</td>
                  <td>{c.source}</td>
                  <td className="r num">{c.ordersCount}</td>
                  <td className="r num">{c.purchases ? money(c.purchases) : '—'}</td>
                  <td className={`r num ${(c.debt ?? 0) > 0 ? 'debt' : ''}`}>{c.debt ? money(c.debt) : '—'}</td>
                </RowLink>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ім'я</th>
                <th>Компанія</th>
                <th>Телефон</th>
                <th className="r">Бонус</th>
                <th className="r">Замовлень</th>
                <th className="r">У роботі</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <RowLink key={c.id} onOpen={() => setEditDes(c.id)}>
                  <td>{c.name}</td>
                  <td>{c.company || <span className="muted">—</span>}</td>
                  <td className="num">{c.phone || '—'}</td>
                  <td className="r num">
                    {c.effectiveBonusPct}%{c.bonusPct == null && <small className="muted"> заг.</small>}
                  </td>
                  <td className="r num">{c.ordersCount}</td>
                  <td className="r num">{c.activeCount || '—'}</td>
                </RowLink>
              ))}
            </tbody>
          </table>
        )}
        {list.isPending && <div className="empty">Завантаження…</div>}
        {list.isSuccess && !rows.length && (
          <div className="empty">{tab === 'des' ? 'Дизайнерів не знайдено. Натисніть «+ Дизайнер-партнер».' : 'Клієнтів не знайдено.'}</div>
        )}
      </div>
      {tab === 'des' && (
        <div className="note" style={{ marginTop: 12 }}>
          Дизайнери з цього списку з'являються у виборі «Дизайнер-партнер», коли в новому зверненні джерело — «дизайнер». Бонус порожній — береться
          загальний % із налаштувань ({pct}%).
        </div>
      )}
      {modal === 'client' && <NewClientModal onClose={() => setModal(null)} />}
      {modal === 'designer' && <DesignerModal onClose={() => setModal(null)} />}
      {editDes != null && <DesignerModal id={editDes} onClose={() => setEditDes(null)} />}
    </>
  );
}

/* ---------- Форма «Контакти» ---------- */

type ClientForm = {
  name: string;
  phone: string;
  type: string;
  source: string;
  email: string;
  messenger: string;
  company: string;
  bonusPct: string;
  addresses: string;
  comment: string;
};

const toForm = (c?: ClientFull | null): ClientForm => ({
  name: c?.name ?? '',
  phone: c?.phone ?? '',
  type: c?.type ?? 'фізособа',
  source: c?.source ?? 'Instagram',
  email: c?.email ?? '',
  messenger: c?.messenger ?? '',
  company: c?.company ?? '',
  bonusPct: c?.bonusPct != null ? String(c.bonusPct) : '',
  addresses: (c?.addresses ?? []).join('\n'),
  comment: c?.comment ?? '',
});

const toBody = (f: ClientForm) => ({
  name: f.name,
  phone: f.phone,
  type: f.type,
  source: f.source || null,
  email: f.email,
  messenger: f.messenger,
  company: f.type === DESIGNER ? f.company : null,
  bonusPct: f.type === DESIGNER && f.bonusPct.trim() ? Number(f.bonusPct.replace(',', '.')) : null,
  addresses: f.addresses.split('\n').map((s) => s.trim()).filter(Boolean),
  comment: f.comment,
});

function ContactFields({ f, set, pct }: { f: ClientForm; set: (f: ClientForm) => void; pct: number }) {
  const d = f.type === DESIGNER;
  return (
    <>
      <div className="grid">
        <label className="f">
          ПІБ або назва *
          <input value={f.name} onChange={(e) => set({ ...f, name: e.target.value })} />
        </label>
        <label className="f">
          Телефон{d ? '' : ' *'}
          <input inputMode="tel" value={f.phone} onChange={(e) => set({ ...f, phone: e.target.value })} />
        </label>
        <label className="f">
          Тип
          <select value={f.type} onChange={(e) => set({ ...f, type: e.target.value })}>
            {CLIENT_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="f">
          Джерело
          <select value={f.source} onChange={(e) => set({ ...f, source: e.target.value })}>
            {SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="f">
          Email
          <input type="email" value={f.email} onChange={(e) => set({ ...f, email: e.target.value })} />
        </label>
        <label className="f">
          Месенджер
          <input value={f.messenger} onChange={(e) => set({ ...f, messenger: e.target.value })} />
        </label>
        {d && (
          <>
            <label className="f">
              Компанія / студія
              <input value={f.company} onChange={(e) => set({ ...f, company: e.target.value })} />
            </label>
            <label className="f">
              Бонус дизайнера, %
              <input inputMode="decimal" value={f.bonusPct} placeholder={`${pct} (як у налаштуваннях)`} onChange={(e) => set({ ...f, bonusPct: e.target.value })} />
            </label>
          </>
        )}
      </div>
      <label className="f">
        Адреси об'єктів (кожна з нового рядка)
        <textarea value={f.addresses} onChange={(e) => set({ ...f, addresses: e.target.value })} />
      </label>
      <label className="f">
        Коментар
        <textarea value={f.comment} onChange={(e) => set({ ...f, comment: e.target.value })} />
      </label>
    </>
  );
}

function NewClientModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const refresh = useInvalidateClients();
  const { openClient } = useDrawer();
  const pct = useSettingsPct();
  const [f, setF] = useState(toForm());
  const [err, setErr] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<{ id: number }>('/clients', toBody(f)),
    onSuccess: (r) => {
      refresh();
      toast('Клієнта створено');
      onClose();
      openClient(r.id);
    },
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal onClose={onClose} onSubmit={() => m.mutate()} labelledBy="nc-title">
      <h2 id="nc-title">Новий клієнт</h2>
      <ContactFields f={f} set={setF} pct={pct} />
      <WarnBox>{err}</WarnBox>
      <div className="act">
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={m.isPending}>
          Створити
        </button>
      </div>
    </Modal>
  );
}

/** Картка клієнта — панель справа. */
export function ClientDrawer({ id }: { id: number }) {
  const { close, openOrder } = useDrawer();
  const toast = useToast();
  const refresh = useInvalidateClients();
  const pct = useSettingsPct();
  const q = useQuery({ queryKey: ['client', id], queryFn: () => api.get<ClientCard>(`/clients/${id}`) });
  const [f, setF] = useState<ClientForm | null>(null);
  const [newOrder, setNewOrder] = useState(false);
  const [err, setErr] = useState('');
  const form = f ?? toForm(q.data);
  const save = useMutation({
    mutationFn: (body: object) => api.patch(`/clients/${id}`, body),
    onSuccess: (_r, body) => {
      refresh();
      setErr('');
      setF(null);
      if ('archived' in body) {
        toast((body as { archived: boolean }).archived ? 'Клієнта перенесено в архів' : 'Клієнта повернуто');
        close();
      } else toast('Клієнта збережено');
    },
    onError: (e) => setErr(errorText(e)),
  });
  const c = q.data;
  return (
    <Drawer onClose={close} label="Клієнт">
      <div className="dh">
        <div className="t">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Клієнт · {c?.type ?? ''}
            </div>
            <h1>{c?.name ?? 'Завантаження…'}</h1>
          </div>
          <button type="button" className="btn sm" onClick={close} aria-label="Закрити">
            ✕
          </button>
        </div>
      </div>
      <div className="db">
        {q.isError && <div className="warnbox">Не вдалося відкрити клієнта: {q.error.message}</div>}
        {c && (
          <>
            <form
              className="sec"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(toBody(form));
              }}
            >
              <div className="hd">
                <h2>Контакти</h2>
                <button type="submit" className="btn sm pri" disabled={save.isPending}>
                  Зберегти
                </button>
              </div>
              <ContactFields f={form} set={setF} pct={pct} />
              <WarnBox>{err}</WarnBox>
            </form>
            <div className="sec">
              <div className="hd">
                <h2>Замовлення ({c.orders.length})</h2>
                <button type="button" className="btn sm pri" onClick={() => setNewOrder(true)}>
                  + Нове звернення
                </button>
              </div>
              {c.orders.length ? (
                <div className="list">
                  {c.orders.map((o) => (
                    <div className="li" key={o.id} style={{ cursor: 'pointer' }} tabIndex={0} onClick={() => openOrder(o.id)} onKeyDown={(e) => e.key === 'Enter' && openOrder(o.id)}>
                      <div className="m">
                        <span className="num">№{o.num}</span> <StatusPill s={o.status} />
                        <small>{o.itemNames.join(', ') || '—'}</small>
                      </div>
                      <div style={{ textAlign: 'right' }} className="num">
                        {money(o.price)}
                        {o.debt > 0 && o.paid > 0 && <small className="debt">борг {money(o.debt)}</small>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">Замовлень ще немає.</div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              {c.archived ? (
                <button type="button" className="btn sm" onClick={() => save.mutate({ archived: false })}>
                  Повернути з архіву
                </button>
              ) : (
                <ConfirmButton className="btn sm warn" onConfirm={() => save.mutate({ archived: true })}>
                  В архів
                </ConfirmButton>
              )}
            </div>
          </>
        )}
      </div>
      {newOrder && c && <NewOrderModal client={c} onClose={() => setNewOrder(false)} />}
    </Drawer>
  );
}

/** Форма дизайнера-партнера (створення / редагування з його замовленнями й архівом). */
export function DesignerModal({ id, onClose, onCreated }: { id?: number; onClose: () => void; onCreated?: (id: number) => void }) {
  const toast = useToast();
  const refresh = useInvalidateClients();
  const { openOrder } = useDrawer();
  const pct = useSettingsPct();
  const q = useQuery({ queryKey: ['client', id], queryFn: () => api.get<ClientCard>(`/clients/${id}`), enabled: id != null });
  const [v, setV] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState('');
  const c = q.data;
  const val = v ?? {
    name: c?.name ?? '',
    company: c?.company ?? '',
    phone: c?.phone ?? '',
    email: c?.email ?? '',
    messenger: c?.messenger ?? '',
    bonusPct: c?.bonusPct != null ? String(c.bonusPct) : '',
    comment: c?.comment ?? '',
  };
  const set = (k: string, x: string) => setV({ ...val, [k]: x });
  const body = () => ({
    name: val.name,
    company: val.company,
    phone: val.phone,
    email: val.email,
    messenger: val.messenger,
    bonusPct: val.bonusPct!.trim() ? Number(val.bonusPct!.replace(',', '.')) : null,
    comment: val.comment,
    type: DESIGNER,
    source: 'дизайнер',
  });
  const save = useMutation({
    mutationFn: async () => {
      if (id) {
        await api.patch(`/clients/${id}`, body());
        return id;
      }
      return (await api.post<{ id: number }>('/clients', body())).id;
    },
    onSuccess: (newId) => {
      refresh();
      toast(id ? 'Збережено' : 'Дизайнера додано');
      onCreated?.(newId);
      onClose();
    },
    onError: (e) => setErr(errorText(e)),
  });
  const arch = useMutation({
    mutationFn: () => api.patch(`/clients/${id}`, { archived: !c!.archived }),
    onSuccess: () => {
      refresh();
      toast(c!.archived ? 'Повернуто з архіву' : 'Перенесено в архів');
      onClose();
    },
    onError: (e) => setErr(errorText(e)),
  });
  if (id && !c) {
    return (
      <Modal onClose={onClose}>
        <div>{q.isError ? 'Не вдалося завантажити.' : 'Завантаження…'}</div>
      </Modal>
    );
  }
  const designerOrders = c ? c.orders : [];
  return (
    <Modal onClose={onClose} onSubmit={() => (val.name!.trim() ? save.mutate() : setErr("Вкажіть ім'я дизайнера."))} labelledBy="des-title">
      <h2 id="des-title">{id ? 'Дизайнер-партнер' : 'Новий дизайнер-партнер'}</h2>
      <div className="grid">
        <label className="f">
          Ім'я дизайнера *
          <input value={val.name} placeholder="Оксана Лис" onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="f">
          Компанія / студія
          <input value={val.company} placeholder="Студія «Простір»" onChange={(e) => set('company', e.target.value)} />
        </label>
        <label className="f">
          Телефон
          <input inputMode="tel" value={val.phone} placeholder="+380 __ ___ __ __" onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label className="f">
          Email
          <input type="email" value={val.email} onChange={(e) => set('email', e.target.value)} />
        </label>
        <label className="f">
          Месенджер / Instagram
          <input value={val.messenger} onChange={(e) => set('messenger', e.target.value)} />
        </label>
        <label className="f">
          Бонус дизайнера, %
          <input inputMode="decimal" value={val.bonusPct} placeholder={`${pct} (як у налаштуваннях)`} onChange={(e) => set('bonusPct', e.target.value)} />
        </label>
      </div>
      <label className="f">
        Коментар
        <textarea value={val.comment} onChange={(e) => set('comment', e.target.value)} />
      </label>
      {c && (
        <div className="sec" style={{ marginTop: 6 }}>
          <h2>Замовлення ({designerOrders.length})</h2>
          {designerOrders.length ? (
            <div className="list">
              {designerOrders.map((o) => (
                <div
                  className="li"
                  key={o.id}
                  style={{ cursor: 'pointer' }}
                  tabIndex={0}
                  onClick={() => {
                    onClose();
                    openOrder(o.id);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && openOrder(o.id)}
                >
                  <div className="m">
                    <span className="num">№{o.num}</span> <StatusPill s={o.status} />
                    <small>{o.client.name}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">Замовлень ще немає.</div>
          )}
        </div>
      )}
      <WarnBox>{err}</WarnBox>
      <div className="act">
        {c && (
          <span style={{ marginRight: 'auto' }}>
            {c.archived ? (
              <button type="button" className="btn" onClick={() => arch.mutate()}>
                Повернути з архіву
              </button>
            ) : (
              <ConfirmButton onConfirm={() => arch.mutate()}>В архів</ConfirmButton>
            )}
          </span>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={save.isPending}>
          {id ? 'Зберегти' : 'Додати'}
        </button>
      </div>
    </Modal>
  );
}

