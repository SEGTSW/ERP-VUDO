import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { fmtDate, isOffice } from '@vudo/shared';
import { api, errorText } from '../../api';
import { useMe } from '../../session';
import type { PlanTask } from '../../types';
import { useToast } from '../../ui/toast';
import { TaskModal, useInvalidatePlan } from '../../plan/TaskModal';

/** Вкладка «План»: по кожному виробу 5 етапів; клік — вікно етапу; «На діаграмі» — Планування з фільтром за замовленням. */
export function PlanTab({
  orderId,
  num,
  clientName,
  tasks,
  items,
}: {
  orderId: number;
  num: string;
  clientName: string;
  tasks: PlanTask[];
  items: { id: number; name: string }[];
}) {
  const { user } = useMe();
  const office = isOffice(user);
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useInvalidatePlan();
  const [open, setOpen] = useState<PlanTask | null>(null);
  const create = useMutation({
    mutationFn: () => api.post(`/orders/${orderId}/plan`),
    onSuccess: () => {
      refresh();
      toast('План етапів створено');
    },
    onError: (e) => toast(errorText(e), true),
  });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const list = [...tasks].sort((a, b) => a.idx - b.idx);
  return (
    <>
      <div className="sec">
        <div className="hd">
          <h2>План робіт по об'єкту</h2>
          {list.length ? (
            <button type="button" className="btn sm" onClick={() => navigate(`/plan?pOrder=${orderId}`)}>
              На діаграмі
            </button>
          ) : (
            office && (
              <button type="button" className="btn sm pri" disabled={create.isPending} onClick={() => create.mutate()}>
                Створити план етапів
              </button>
            )
          )}
        </div>
        {!!items.length && <small className="muted">Вироби: {items.map((i) => i.name).join(', ')}</small>}
        {list.length ? (
          <div className="list">
            {list.map((t) => {
              const r = t.sched;
              return (
                <div className="li" key={t.id} style={{ cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => setOpen(t)} onKeyDown={(e) => e.key === 'Enter' && setOpen(t)}>
                  <div className="m">
                    <span className={r.planned ? (r.done ? 'st-done' : r.late ? 'st-late' : 'st-ok') : ''}>{t.stage}</span>
                    <small>{t.assigneeName ?? '—'}</small>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {r.planned ? (
                      <>
                        <span className="num">
                          {fmtDate(r.start)} – {fmtDate(r.last)}
                        </span>
                        <small>
                          {t.days} дн. · {t.progress}%{r.late && <b className="st-late"> · прострочено {r.lateBy} дн.</b>}
                        </small>
                      </>
                    ) : (
                      <small className="debt">дні не вказано</small>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty">План для цього замовлення ще не створено.</div>
        )}
      </div>
      <div className="note">Кожен відповідальний вказує, скільки днів займе його етап. Дні календарні; етапи йдуть ланцюжком.</div>
      {open && <TaskModal task={open} prev={open.sched.prevId ? byId.get(open.sched.prevId) : null} title={`№${num} · ${clientName}`} onClose={() => setOpen(null)} />}
    </>
  );
}
