import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SOURCES, daysBetween, fmtDate, money } from '@vudo/shared';
import { api } from '../../api';
import type { ClientRow, OfficeCard } from '../../types';
import { ConfirmButton } from '../../ui/common';
import { useOrderAction, usePeople } from '../hooks';
import { InstallersPick, PersonSelect, peopleWith } from '../PeoplePick';
import { designerLabel, useDesigners } from '../NewOrderModal';
import { DesignerModal } from '../../pages/Clients';

type Form = {
  clientId: number;
  address: string;
  source: string | null;
  designerId: number | null;
  managerId: number;
  measurerId: number | null;
  constructorId: number | null;
  installerIds: number[];
  measureDate: string;
  installDate: string;
  readyDate: string;
  delivery: string;
  discount: string;
  discountType: 'грн' | '%';
  comment: string;
};

const fromCard = (o: OfficeCard): Form => ({
  clientId: o.client.id,
  address: o.address ?? '',
  source: o.source,
  designerId: o.designer?.id ?? null,
  managerId: o.managerId,
  measurerId: o.measurerId,
  constructorId: o.constructorId,
  installerIds: o.installerIds,
  measureDate: o.measureDate ?? '',
  installDate: o.installDate ?? '',
  readyDate: o.readyDate ?? '',
  delivery: o.delivery ? String(o.delivery) : '',
  discount: o.discount ? String(o.discount) : '',
  discountType: o.discountType,
  comment: o.comment ?? '',
});

const num = (s: string) => Number(s.replace(',', '.').replace(/\s/g, '')) || 0;

/** Вкладка «Загальне»: форма, згрупована в блоки, і кнопка «Зберегти». */
export function MainTab({ o }: { o: OfficeCard }) {
  const people = usePeople().data ?? [];
  const designers = useDesigners().data ?? [];
  const clients = useQuery({ queryKey: ['clients', 'all-for-select'], queryFn: () => api.get<ClientRow[]>('/clients') });
  const [f, setF] = useState<Form>(() => fromCard(o));
  const [newDes, setNewDes] = useState(false);
  // Після збереження / зміни статусу — підтягнути свіжі дані картки
  useEffect(() => setF(fromCard(o)), [o]);

  const save = useOrderAction(
    o.id,
    () =>
      api.patch<OfficeCard>(`/orders/${o.id}`, {
        ...f,
        designerId: f.source === 'дизайнер' ? f.designerId : null,
        delivery: num(f.delivery),
        discount: num(f.discount),
      }),
    'Збережено',
  );
  const archive = useOrderAction(o.id, () => api.post<OfficeCard>(`/orders/${o.id}/archive`, { archived: !o.archived }), o.archived ? 'Повернуто з архіву' : 'Перенесено в архів');

  // Ціна з урахуванням введених (ще не збережених) доставки й знижки
  const gross = o.sums.items + num(f.delivery);
  const disc = f.discountType === '%' ? (gross * num(f.discount)) / 100 : num(f.discount);
  const price = Math.max(0, gross - disc);
  const lateBy = o.planInstall && f.installDate && o.planInstall > f.installDate ? daysBetween(f.installDate, o.planInstall) : 0;
  const clientList = (clients.data ?? []).filter((c) => !c.archived || c.id === o.client.id);
  if (!clientList.some((c) => c.id === o.client.id)) clientList.unshift({ ...o.client, ordersCount: 0 });
  const managers = peopleWith(people, ['Менеджер', 'Адмін'], [o.managerId]);
  const H = ({ t }: { t: string }) => <div className="fgrp-h">{t}</div>;

  return (
    <>
      <div className="sec">
        <div className="hd">
          <h2>Дані замовлення</h2>
          <button type="button" className="btn sm pri" disabled={save.isPending} onClick={() => save.mutate(undefined)}>
            Зберегти
          </button>
        </div>
        <H t="Клієнт і джерело" />
        <div className="fgrid">
          <label className="f">
            Клієнт
            <select value={f.clientId} onChange={(e) => setF({ ...f, clientId: Number(e.target.value) })}>
              {clientList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="f span2">
            Адреса об'єкта
            <input value={f.address} list="order-addrs" placeholder="місто, вулиця, будинок, квартира" onChange={(e) => setF({ ...f, address: e.target.value })} />
            <datalist id="order-addrs">
              {o.client.addresses.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </label>
          <label className="f">
            Джерело
            <select value={f.source ?? ''} onChange={(e) => setF({ ...f, source: e.target.value || null })}>
              <option value="" />
              {SOURCES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {f.source === 'дизайнер' && (
            <div className="f span2">
              <span className="fl">
                Дизайнер-партнер
                <button type="button" className="lnkbtn" onClick={() => setNewDes(true)}>
                  + Новий дизайнер-партнер
                </button>
              </span>
              <select value={f.designerId ?? ''} onChange={(e) => setF({ ...f, designerId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— не вибрано —</option>
                {o.designer && !designers.some((d) => d.id === o.designer!.id) && (
                  <option value={o.designer.id}>
                    {designerLabel(o.designer)} · {o.designer.bonusPct}%
                  </option>
                )}
                {designers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {designerLabel(d)} · {d.effectiveBonusPct}%
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <H t="Команда" />
        <div className="fgrid g4">
          <label className="f">
            Менеджер
            <select value={f.managerId} onChange={(e) => setF({ ...f, managerId: Number(e.target.value) })}>
              {managers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="f">
            Замірник
            <PersonSelect people={people} roles={['Замірник']} value={f.measurerId} onChange={(v) => setF({ ...f, measurerId: v })} />
          </label>
          <label className="f">
            Конструктор
            <PersonSelect people={people} roles={['Конструктор']} value={f.constructorId} onChange={(v) => setF({ ...f, constructorId: v })} />
          </label>
          <div className="f">
            Монтажники
            <InstallersPick people={people} value={f.installerIds} onChange={(v) => setF({ ...f, installerIds: v })} />
          </div>
        </div>
        <H t="Дати" />
        <div className="fgrid g4">
          <label className="f">
            Дата заміру
            <input type="date" value={f.measureDate} onChange={(e) => setF({ ...f, measureDate: e.target.value })} />
          </label>
          <label className="f">
            Монтаж — обіцяли клієнту
            <input type="date" value={f.installDate} onChange={(e) => setF({ ...f, installDate: e.target.value })} />
            {o.planInstall && (
              <span className={`fh ${lateBy ? 'debt' : ''}`}>
                за планом працівників: {fmtDate(o.planInstall).slice(0, 5)}
                {lateBy ? ` · не встигаємо на ${lateBy} дн.` : ''}
              </span>
            )}
          </label>
          <label className="f">
            Готовність (план)
            <input type="date" value={f.readyDate} onChange={(e) => setF({ ...f, readyDate: e.target.value })} />
          </label>
          <label className="f">
            Дата договору
            <input value={fmtDate(o.contractDate)} disabled />
          </label>
        </div>
        <H t="Гроші" />
        <div className="fgrid g4">
          <label className="f">
            Доставка, грн
            <input inputMode="decimal" value={f.delivery} placeholder="0" onChange={(e) => setF({ ...f, delivery: e.target.value })} />
          </label>
          <label className="f">
            Знижка
            <span style={{ display: 'flex', gap: 6 }}>
              <input inputMode="decimal" value={f.discount} placeholder="0" style={{ flex: 1, minWidth: 0 }} onChange={(e) => setF({ ...f, discount: e.target.value })} />
              <select value={f.discountType} onChange={(e) => setF({ ...f, discountType: e.target.value as 'грн' | '%' })} aria-label="Тип знижки">
                <option>грн</option>
                <option>%</option>
              </select>
            </span>
          </label>
          <div className="f span2">
            Ціна замовлення
            <div className="pricebox num">
              Ціна = вироби {money(o.sums.items)} + доставка {money(num(f.delivery))} − знижка {money(disc)} = <b>{money(price)}</b>
              {o.contractPrice != null && (
                <>
                  <br />
                  <span className="muted">ціна в договорі: {money(o.contractPrice)}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <H t="Коментар" />
        <textarea
          placeholder="Що хоче клієнт, особливості об'єкта (поверх, ліфт, домофон)"
          value={f.comment}
          onChange={(e) => setF({ ...f, comment: e.target.value })}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {o.archived ? (
          <button type="button" className="btn sm" onClick={() => archive.mutate(undefined)}>
            Повернути з архіву
          </button>
        ) : (
          <ConfirmButton className="btn sm warn" onConfirm={() => archive.mutate(undefined)}>
            В архів
          </ConfirmButton>
        )}
      </div>
      {newDes && (
        <DesignerModal
          onClose={() => setNewDes(false)}
          onCreated={(id) => setF((x) => ({ ...x, designerId: id }))}
        />
      )}
    </>
  );
}
