import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { addDays, fmtDate, isOffice, kyivToday } from '@vudo/shared';
import { api, errorText } from '../api';
import { useMe } from '../session';
import type { MyDayData, Visit } from '../types';
import { useDrawer } from '../orders/hooks';
import { IssueModal, IssuesList } from '../orders/Issues';
import { useInvalidatePlan } from '../plan/TaskModal';
import { useToast } from '../ui/toast';

const WD = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', "п'ятниця", 'субота'];
const mapsURL = (a: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a)}`;
/** tel: у міжнародному форматі (10 цифр → +38…). */
const telHref = (p: string) => {
  const d = p.replace(/\D/g, '');
  return `tel:${d.length === 10 ? `+38${d}` : p.replace(/[^\d+]/g, '')}`;
};

/** 8А.3 Мій день (монтажник, замірник) / Виїзди (менеджер і власник вибирають працівника). Екран розрахований на телефон. */
export function MyDay() {
  const { user } = useMe();
  const boss = isOffice(user);
  const [day, setDay] = useState(kyivToday());
  const [who, setWho] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['myday', who, day],
    queryFn: () => api.get<MyDayData>(`/myday?${new URLSearchParams({ date: day, ...(who ? { user: String(who) } : {}) })}`),
  });
  const today = kyivToday();
  const d = q.data;
  const wd = WD[new Date(`${day}T12:00:00Z`).getUTCDay()];

  return (
    <>
      <div className="bar">
        <h1 className="grow">{boss ? 'Виїзди' : 'Мій день'}</h1>
        {boss && !!d?.people.length && (
          <select value={d.userId} onChange={(e) => setWho(Number(e.target.value))} aria-label="Працівник">
            {d.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.roles.join(', ')}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="bar day-nav">
        <button type="button" className="btn sm" aria-label="Попередній день" onClick={() => setDay(addDays(day, -1))}>
          ‹
        </button>
        <b style={{ minWidth: 190, textAlign: 'center' }}>
          {day === today ? 'Сьогодні, ' : day === addDays(today, 1) ? 'Завтра, ' : ''}
          {wd}, <span className="num">{fmtDate(day)}</span>
        </b>
        <button type="button" className="btn sm" aria-label="Наступний день" onClick={() => setDay(addDays(day, 1))}>
          ›
        </button>
        {day !== today && (
          <button type="button" className="btn sm" onClick={() => setDay(today)}>
            Сьогодні
          </button>
        )}
      </div>
      {q.isPending && <div className="empty">Завантаження…</div>}
      {q.isError && <div className="warnbox">Не вдалося завантажити. Оновіть сторінку.</div>}
      {boss && d && !d.people.length && <div className="empty">Немає працівників з роллю «Монтажник» або «Замірник».</div>}
      {d && (d.visits.length ? (
        <div className="shop">
          {d.visits.map((v) => (
            <VisitCard key={`${v.orderId}-${v.stage}`} v={v} canDone={boss || d.userId === user.id} />
          ))}
        </div>
      ) : (
        !!d.userId && <div className="empty">На цей день виїздів немає.</div>
      ))}
      {!!d?.upcoming.length && (
        <>
          <div className="grp-h">Найближчі виїзди</div>
          <div className="list sec">
            {d.upcoming.flatMap((u) =>
              u.visits.map((x) => (
                <div className="li" key={`${u.date}-${x.orderId}-${x.stage}`} style={{ cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => setDay(u.date)} onKeyDown={(e) => e.key === 'Enter' && setDay(u.date)}>
                  <div className="m">
                    <b className="num">{fmtDate(u.date)}</b> · {x.stage} · {x.address || x.clientName}
                    <small>
                      №{x.num} · {x.clientName}
                    </small>
                  </div>
                  <span className="muted">›</span>
                </div>
              )),
            )}
          </div>
        </>
      )}
    </>
  );
}

function VisitCard({ v, canDone }: { v: Visit; canDone: boolean }) {
  const toast = useToast();
  const refresh = useInvalidatePlan();
  const { openOrder } = useDrawer();
  const [issue, setIssue] = useState(false);
  const mount = v.stage === 'Монтаж';
  const done = useMutation({
    mutationFn: () => api.post('/myday/done', { taskIds: v.taskIds }),
    onSuccess: () => {
      refresh();
      toast('Позначено як виконане');
    },
    onError: (e) => toast(errorText(e), true),
  });
  return (
    <div className="visit" style={v.done ? { opacity: 0.6 } : undefined}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className={`kind ${mount ? 'st-ok' : ''}`} style={mount ? undefined : { color: 'var(--s-field-fg)' }}>
          {mount ? 'Монтаж / доставка' : 'Замір'}
          {v.done ? ' · виконано' : ''}
        </span>
        <span className="muted num" style={{ fontSize: 12 }}>
          №{v.num}
        </span>
      </div>
      <div>
        <div className="addr">{v.address || 'адресу не вказано'}</div>
        <div className="muted">{v.clientName}</div>
      </div>
      <div className="row">
        {v.address && (
          <a className="btn sm pri" href={mapsURL(v.address)} target="_blank" rel="noopener noreferrer">
            Відкрити в картах
          </a>
        )}
        {v.phone && (
          <>
            <a className="btn sm" href={telHref(v.phone)}>
              Подзвонити {v.phone}
            </a>
            <button
              type="button"
              className="btn sm"
              onClick={() =>
                navigator.clipboard
                  .writeText(v.phone!)
                  .then(() => toast('Телефон скопійовано'))
                  .catch(() => toast('Не вдалося скопіювати', true))
              }
            >
              Копіювати
            </button>
          </>
        )}
      </div>
      {mount ? (
        <div>
          <h4>Що везти</h4>
          <div className="list">
            {v.items.map((i) => (
              <div className="li" key={i.id}>
                <div className="m">
                  {i.name} <span className="muted">· {i.type}</span>
                </div>
              </div>
            ))}
            {!v.items.length && <div className="muted">Вироби не вказано.</div>}
          </div>
        </div>
      ) : (
        <div>
          <h4>Що заміряти</h4>
          <div>{v.comment || v.items.map((i) => i.name).join(', ') || '—'}</div>
        </div>
      )}
      {mount && (
        <div>
          <h4>Ключові креслення</h4>
          {v.files.length ? (
            <div className="list">
              {v.files.map((f) => (
                <a key={f.id} className="li" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="m">
                    {f.name}
                    <small>
                      {f.category === 'design' ? 'дизайн-проєкт' : 'конструктив'} · {fmtDate(f.createdAt)}
                    </small>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="muted">Креслень ще немає.</div>
          )}
        </div>
      )}
      {mount && v.comment && <div className="note">{v.comment}</div>}
      <IssuesList issues={v.issues} />
      <div className="row">
        <button type="button" className="btn sm pri" onClick={() => openOrder(v.orderId, 'main')}>
          ℹ Інформація про об'єкт
        </button>
        {!!v.items.length && (
          <button type="button" className="btn sm" onClick={() => openOrder(v.orderId, 'items')}>
            Вироби ({v.items.length})
          </button>
        )}
      </div>
      <div className="row">
        {mount && (
          <>
            <button type="button" className="btn sm" onClick={() => openOrder(v.orderId, 'files')}>
              Усі файли
            </button>
            <button type="button" className="btn sm" onClick={() => setIssue(true)}>
              ⚠ Не вистачає / брак
            </button>
          </>
        )}
        {!v.done && !!v.taskIds.length && canDone && (
          <button type="button" className="btn sm pri" style={{ marginLeft: 'auto' }} disabled={done.isPending} onClick={() => done.mutate()}>
            {mount ? 'Змонтовано ✓' : 'Замір виконано ✓'}
          </button>
        )}
      </div>
      {issue && <IssueModal orderId={v.orderId} num={v.num} clientName={v.clientName} items={v.items} onClose={() => setIssue(false)} />}
    </div>
  );
}
