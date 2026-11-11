import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fmtDate, isOffice } from '@vudo/shared';
import { api, errorText } from '../api';
import { useMe } from '../session';
import type { PlanTask } from '../types';
import { Modal, WarnBox } from '../ui/common';
import { useToast } from '../ui/toast';
import { usePeople } from '../orders/hooks';

/** Після зміни етапу оновлюємо все, де видно план. */
export function useInvalidatePlan() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['plan', 'order', 'orders', 'log', 'myday']) void qc.invalidateQueries({ queryKey: [k] });
  };
}

/**
 * Вікно етапу (8.3): період і %, попередній етап; поля «Відповідальний», «Скільки днів займе*», «Початок», «Виконано, %», коментар.
 * Редагує відповідальний, менеджер або адмін; інші — лише читання з приміткою.
 */
export function TaskModal({
  task,
  prev,
  title,
  onClose,
}: {
  task: PlanTask;
  prev?: PlanTask | null;
  title?: string;
  onClose: () => void;
}) {
  const { user } = useMe();
  const toast = useToast();
  const refresh = useInvalidatePlan();
  const people = usePeople().data ?? [];
  const office = isOffice(user);
  const can = office || task.assigneeId === user.id;
  const r = task.sched;
  const [v, setV] = useState({
    assigneeId: task.assigneeId,
    days: task.days ? String(task.days) : '',
    startDate: task.startDate ?? '',
    progress: task.progress,
    comment: task.comment ?? '',
  });
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/plan/tasks/${task.id}`, {
        days: Number(v.days),
        startDate: v.startDate || null,
        progress: v.progress,
        comment: v.comment,
        ...(office && v.assigneeId ? { assigneeId: v.assigneeId } : {}),
      }),
    onSuccess: () => {
      refresh();
      toast('План оновлено');
      onClose();
    },
    onError: (e) => setErr(errorText(e)),
  });
  const assignees = people.filter((p) => !p.disabled || p.id === task.assigneeId);

  return (
    <Modal
      onClose={onClose}
      onSubmit={() => {
        const d = Number(v.days);
        if (!Number.isInteger(d) || d < 1 || d > 120) return setErr('Вкажіть кількість днів (від 1 до 120).');
        save.mutate();
      }}
      labelledBy="task-title"
    >
      {title && (
        <div className="muted" style={{ fontSize: 12 }}>
          {title}
        </div>
      )}
      <h2 id="task-title">
        {task.itemName} — {task.stage}
      </h2>
      {r.planned ? (
        <div className={`${r.late ? 'warnbox' : 'okbox'} num`}>
          {fmtDate(r.start)} – {fmtDate(r.last)} · {task.days} дн. · виконано {task.progress}%{r.late ? ` · прострочено на ${r.lateBy} дн.` : ''}
        </div>
      ) : (
        <div className="note">Дні ще не вказано — етап не видно на діаграмі.</div>
      )}
      {prev?.sched.planned && (
        <div className="note">
          Попередній етап: {prev.stage} ({prev.assigneeName ?? '—'}), закінчується {fmtDate(prev.sched.last)}.
        </div>
      )}
      <div className="grid">
        <label className="f">
          Відповідальний
          {office ? (
            <select value={v.assigneeId ?? ''} onChange={(e) => setV({ ...v, assigneeId: Number(e.target.value) || null })}>
              {!v.assigneeId && <option value="">— не вибрано —</option>}
              {assignees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.roles.join(', ')}
                </option>
              ))}
            </select>
          ) : (
            <input value={task.assigneeName ?? '—'} disabled />
          )}
        </label>
        <label className="f">
          Скільки днів займе *
          <input inputMode="numeric" value={v.days} disabled={!can} onChange={(e) => setV({ ...v, days: e.target.value.replace(/\D/g, '') })} />
        </label>
        <label className="f">
          Початок
          <input type="date" value={v.startDate} disabled={!can} onChange={(e) => setV({ ...v, startDate: e.target.value })} />
          <span style={{ fontSize: 11 }}>порожньо — одразу після попереднього етапу</span>
        </label>
        <label className="f">
          Виконано, %
          <select value={v.progress} disabled={!can} onChange={(e) => setV({ ...v, progress: Number(e.target.value) })}>
            {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((p) => (
              <option key={p} value={p}>
                {p}%
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="f">
        Коментар
        <textarea value={v.comment} disabled={!can} onChange={(e) => setV({ ...v, comment: e.target.value })} />
      </label>
      {!can && <div className="note">Змінювати етап може відповідальний або менеджер.</div>}
      <WarnBox>{err}</WarnBox>
      <div className="act">
        <button type="button" className="btn" onClick={onClose}>
          {can ? 'Скасувати' : 'Закрити'}
        </button>
        {can && (
          <button type="submit" className="btn pri" disabled={save.isPending}>
            Зберегти
          </button>
        )}
      </div>
    </Modal>
  );
}
