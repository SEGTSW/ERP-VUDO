import type { ReactNode } from 'react';
import { fmtDate } from '@vudo/shared';
import type { ExecCard } from '../../types';
import { useToast } from '../../ui/toast';

const Row = ({ label, children }: { label: string; children: ReactNode }) =>
  children ? (
    <div className="li">
      <div className="m">
        <small>{label}</small>
        {children}
      </div>
    </div>
  ) : null;

/** Вкладка «Інформація» для виконавців: порожні поля не показуються. */
export function ExecInfoTab({ o }: { o: ExecCard }) {
  const toast = useToast();
  const other = o.client.addresses.filter((a) => a !== o.address);
  const join = (...x: (string | null | undefined)[]) => x.filter(Boolean).join(' · ');
  return (
    <>
      <div className="sec">
        <div className="hd">
          <h2>Клієнт</h2>
          {o.client.phone && (
            <button
              type="button"
              className="btn sm"
              onClick={() =>
                navigator.clipboard
                  .writeText(o.client.phone!)
                  .then(() => toast('Телефон скопійовано'))
                  .catch(() => toast('Не вдалося скопіювати', true))
              }
            >
              Копіювати телефон
            </button>
          )}
        </div>
        <div className="list">
          <Row label="Ім'я">{o.client.name}</Row>
          <Row label="Телефон">{o.client.phone && <a className="num lnk" href={`tel:${o.client.phone.replace(/[^\d+]/g, '')}`}>{o.client.phone}</a>}</Row>
          <Row label="Месенджер">{o.client.messenger}</Row>
          <Row label="Email">{o.client.email}</Row>
          <Row label="Адреса об'єкта">{o.address}</Row>
          <Row label="Інші адреси">{other.length ? other.join('; ') : null}</Row>
          <Row label="Про клієнта">{o.client.comment}</Row>
          <Row label="Дизайнер">
            {o.designer && (
              <>
                {o.designer.company ? `${o.designer.name} · ${o.designer.company}` : o.designer.name}
                {o.designer.phone && <span className="num"> · {o.designer.phone}</span>}
              </>
            )}
          </Row>
        </div>
      </div>
      <div className="sec">
        <h2>Замовлення</h2>
        <div className="list">
          <Row label="Менеджер">{o.managerName}</Row>
          <Row label="Що хоче клієнт / коментар">{o.comment}</Row>
          <Row label="Замір">{join(o.measureDate && fmtDate(o.measureDate), o.measurerName)}</Row>
          <Row label="Плановий термін готовності">{o.readyDate && fmtDate(o.readyDate)}</Row>
          <Row label="Монтаж">{join(o.installDate && fmtDate(o.installDate), o.installerNames.join(', '))}</Row>
        </div>
      </div>
    </>
  );
}

export function ExecItemsTab({ o }: { o: ExecCard }) {
  return (
    <div className="sec">
      <h2>Вироби</h2>
      {o.items.length ? (
        <div className="list">
          {o.items.map((i) => (
            <div className="li" key={i.id}>
              <div className="m">
                <b style={{ fontWeight: 600 }}>{i.name}</b> <span className="muted">· {i.type}</span>
                <small style={{ whiteSpace: 'pre-wrap' }}>{i.description || 'опису немає'}</small>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">Вироби ще не додані.</div>
      )}
      <div className="note">Креслення, фото заміру і файли дизайн-проєкту — у вкладці «Файли».</div>
    </div>
  );
}
