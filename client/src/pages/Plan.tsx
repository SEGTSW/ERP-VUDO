import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PLAN_STAGES, addDays, daysBetween, fmtDate, initials } from '@vudo/shared';
import { api } from '../api';
import { useMe } from '../session';
import type { PlanData, PlanTaskFull } from '../types';
import { useDrawer, usePeople } from '../orders/hooks';
import { TaskModal } from '../plan/TaskModal';

/** Шкала: 28 днів назад і 70 вперед, клітинка — 28 px. */
const PAST = 28;
const NDAYS = 98;
const DW = 28;
const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];

const dword = (n: number) => {
  const a = n % 10;
  const b = n % 100;
  return a === 1 && b !== 11 ? 'день' : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? 'дні' : 'днів';
};
const ddmm = (d: string | null) => (d ? fmtDate(d).slice(0, 5) : '—');

/** 8. Планування — діаграма Ганта. */
export function Plan() {
  const { user } = useMe();
  const { openOrder } = useDrawer();
  const people = usePeople().data ?? [];
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['plan'], queryFn: () => api.get<PlanData>('/plan'), refetchInterval: 60_000 });
  const [group, setGroup] = useState<'item' | 'person'>('item');
  const [who, setWho] = useState('');
  const [stage, setStage] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [showUnpl, setShowUnpl] = useState(false);
  const [open, setOpen] = useState<PlanTaskFull | null>(null);
  const orderFilter = params.get('pOrder') ?? '';
  const scroller = useRef<HTMLDivElement>(null);

  const data = q.data;
  const today = data?.today ?? '';
  const r0 = today ? addDays(today, -PAST) : '';
  const all = data?.tasks ?? [];
  const byId = useMemo(() => new Map(all.map((t) => [t.id, t])), [all]);

  const filtered = all.filter(
    (t) =>
      (!who || String(t.assigneeId) === who) &&
      (!orderFilter || String(t.orderId) === orderFilter) &&
      (!stage || t.stage === stage) &&
      (showDone || !t.sched.done),
  );
  const planned = filtered.filter((t) => t.sched.planned);
  const unplanned = filtered.filter((t) => !t.sched.planned && t.progress < 100);
  const mineUnpl = all.filter((t) => t.assigneeId === user.id && !t.sched.planned && t.progress < 100);

  // Групи: за виробами (за замовчуванням) або за відповідальними
  const groups = useMemo(() => {
    const m = new Map<number, PlanTaskFull[]>();
    for (const t of [...planned].sort((a, b) => a.sched.start.localeCompare(b.sched.start) || a.idx - b.idx)) {
      const k = group === 'person' ? (t.assigneeId ?? 0) : t.itemId;
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    const g = [...m.entries()].map(([k, rows]) => ({ k, rows }));
    if (group === 'person') g.sort((a, b) => (a.rows[0]!.assigneeName ?? '').localeCompare(b.rows[0]!.assigneeName ?? '', 'uk'));
    else {
      g.sort((a, b) => a.rows[0]!.orderNum.localeCompare(b.rows[0]!.orderNum) || a.rows[0]!.itemPos - b.rows[0]!.itemPos);
      for (const x of g) x.rows.sort((a, b) => a.idx - b.idx);
    }
    return g;
  }, [planned, group]);

  // При відкритті шкала прокручена до сьогодні
  useLayoutEffect(() => {
    if (scroller.current && data) scroller.current.scrollLeft = Math.max(0, (PAST - 4) * DW);
  }, [!!data]);

  if (q.isPending) return <div className="empty">Завантаження…</div>;
  if (q.isError) return <div className="warnbox">Не вдалося завантажити план. Оновіть сторінку.</div>;

  const W = `calc(var(--lw) + ${NDAYS * DW}px)`;
  const idx = (d: string) => daysBetween(r0, d);

  // Шкала: місяці, числа, вихідні, лінії днів, «сьогодні»
  const mons: React.ReactNode[] = [];
  const days: React.ReactNode[] = [];
  const overlay: React.ReactNode[] = [];
  let lastM = '';
  for (let i = 0; i < NDAYS; i++) {
    const d = addDays(r0, i);
    const dt = new Date(`${d}T12:00:00Z`);
    const we = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
    if (d.slice(0, 7) !== lastM) {
      lastM = d.slice(0, 7);
      mons.push(
        <span key={`m${i}`} className="g-mon" style={{ left: i * DW }}>
          {MONTHS[dt.getUTCMonth()]} {dt.getUTCFullYear()}
        </span>,
      );
    }
    days.push(
      <span key={`d${i}`} className={`g-d ${we ? 'we' : ''} ${d === today ? 'td' : ''}`} style={{ left: i * DW }}>
        {dt.getUTCDate()}
      </span>,
    );
    if (we) overlay.push(<div key={`w${i}`} className="g-ov" style={{ left: `calc(var(--lw) + ${i * DW}px)` }} />);
    overlay.push(<div key={`l${i}`} className={`g-vl ${dt.getUTCDate() === 1 ? 'm1' : ''}`} style={{ left: `calc(var(--lw) + ${i * DW + DW / 2}px)` }} />);
  }
  overlay.push(<div key="today" className="g-today" style={{ left: `calc(var(--lw) + ${PAST * DW + DW / 2 - 1}px)` }} />);

  const bar = (t: PlanTaskFull) => {
    const r = t.sched;
    const a = Math.max(0, idx(r.start));
    const endI = Math.min(NDAYS, idx(r.late ? addDays(today, 1) : r.end!));
    if (endI <= 0 || a >= NDAYS) return null;
    const w = Math.max(1, endI - a) * DW - 4;
    const pw = Math.min(100, (((t.days ?? 0) * DW * (t.progress / 100)) / w) * 100);
    const tip = `${t.itemName} · ${t.stage}\n${t.assigneeName ?? '—'}\n${fmtDate(r.start)} – ${fmtDate(r.last)}, ${t.days} дн., виконано ${t.progress}%${r.late ? `\nПрострочено на ${r.lateBy} дн.` : ''}`;
    return (
      <button type="button" className={`gb ${r.done ? 'done' : r.late ? 'late' : ''}`} style={{ left: a * DW + 2, width: w }} title={tip} aria-label={tip} onClick={() => setOpen(t)}>
        <i style={{ width: `${r.done ? 100 : pw}%` }} />
      </button>
    );
  };

  const cls = (t: PlanTaskFull) => (t.sched.done ? 'st-done' : t.sched.late ? 'st-late' : 'st-ok');

  const itemHead = (rows: PlanTaskFull[]) => {
    const f = rows[0]!;
    const miss = all.filter((t) => t.itemId === f.itemId && !t.sched.planned && t.progress < 100).sort((a, b) => a.idx - b.idx);
    const st = rows.map((t) => t.sched.start).sort()[0]!;
    const en = rows.map((t) => (t.sched.late ? addDays(today, 1) : t.sched.end!)).sort().at(-1)!;
    const a = Math.max(0, idx(st));
    const b = Math.min(NDAYS, idx(en));
    const anyLate = rows.some((t) => t.sched.late);
    const allDone = rows.every((t) => t.sched.done) && !miss.length;
    const inst = f.installDate ? idx(f.installDate) : -1;
    return (
      <div className="g-row grp item" key={`h${f.itemId}`}>
        <div className="g-left" title="Відкрити замовлення" role="button" tabIndex={0} onClick={() => openOrder(f.orderId)} onKeyDown={(e) => e.key === 'Enter' && openOrder(f.orderId)}>
          <span className="wr">
            <span className="t1">
              <b>{f.itemName}</b>
            </span>
            <span className="t2">
              №{f.orderNum} · {f.clientName}
              {f.installDate ? ` · монтаж ${ddmm(f.installDate)}` : ''}
            </span>
            {!!miss.length && (
              <span className="t2 miss">
                ще не поставили термін: {miss.map((t) => `${(t.assigneeName ?? '—').split(' ')[0]} (${t.stage.toLowerCase()})`).join(', ')}
              </span>
            )}
          </span>
        </div>
        <div className="g-track" style={{ width: NDAYS * DW }}>
          {b > a && <span className={`span ${allDone ? 'done' : anyLate ? 'late' : ''}`} style={{ left: a * DW + 2, width: (b - a) * DW - 4 }} />}
          {inst >= 0 && inst < NDAYS && <span title={`Планова дата монтажу ${fmtDate(f.installDate)}`} className="dia" style={{ left: inst * DW + 8 }} />}
        </div>
      </div>
    );
  };

  const personHead = (rows: PlanTaskFull[]) => {
    const f = rows[0]!;
    const load = rows.filter((t) => !t.sched.done).reduce((s, t) => s + (t.days ?? 0), 0);
    return (
      <div className="g-row grp" key={`p${f.assigneeId}`}>
        <div className="g-left">
          <span className="av">{initials(f.assigneeName ?? '—')}</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {f.assigneeName ?? '—'}
            <br />
            <small className="muted" style={{ fontWeight: 400 }}>
              {f.assigneeRoles.join(', ')} · в роботі {load} дн.
            </small>
          </span>
        </div>
        <div className="g-track" style={{ width: NDAYS * DW }} />
      </div>
    );
  };

  const row = (t: PlanTaskFull) => {
    const r = t.sched;
    return (
      <div className="g-row" key={t.id}>
        {group === 'item' ? (
          <div className="g-left who-row" role="button" tabIndex={0} onClick={() => setOpen(t)} onKeyDown={(e) => e.key === 'Enter' && setOpen(t)}>
            <span className="av sm">{initials(t.assigneeName ?? '—')}</span>
            <span className="wr">
              <span className={`t1 ${cls(t)}`}>{t.assigneeName ?? '—'}</span>
              <span className="t2">
                {t.stage} · {t.days} {dword(t.days ?? 0)} · {ddmm(r.start)}–{ddmm(r.last)}
                {r.done ? ' · готово' : t.progress ? ` · ${t.progress}%` : ''}
                {r.late && <b className="st-late"> · +{r.lateBy}</b>}
              </span>
            </span>
          </div>
        ) : (
          <div className="g-left" role="button" tabIndex={0} onClick={() => setOpen(t)} onKeyDown={(e) => e.key === 'Enter' && setOpen(t)}>
            <span className={`t1 ${cls(t)}`}>• {t.itemName}</span>
            <span className="t2">
              {t.stage} · №{t.orderNum} · {t.days} дн.{r.late && <b className="st-late"> · +{r.lateBy}</b>}
            </span>
          </div>
        )}
        <div className="g-track" style={{ width: NDAYS * DW }}>
          {bar(t)}
        </div>
      </div>
    );
  };

  const assigneeOpts = people.filter((p) => !p.disabled || all.some((t) => t.assigneeId === p.id));

  return (
    <>
      <div className="bar">
        <h1 className="grow">Планування</h1>
        <div className="legend">
          <span>
            <b style={{ background: 'var(--g)' }} />
            за планом
          </span>
          <span>
            <b style={{ background: 'var(--r)' }} />
            прострочено
          </span>
          <span>
            <b style={{ background: 'var(--dn)' }} />
            виконано
          </span>
          <span>
            <b style={{ background: 'var(--g-soft)' }} />
            залишилось
          </span>
        </div>
      </div>
      {!!mineUnpl.length && (
        <div className="mine">
          <b>Вкажіть, скільки днів займуть ваші етапи ({mineUnpl.length}):</b>
          {mineUnpl.map((t) => (
            <button key={t.id} type="button" className="btn sm pri" onClick={() => setOpen(t)}>
              №{t.orderNum} · {t.itemName} · {t.stage}
            </button>
          ))}
        </div>
      )}
      <div className="bar">
        <select value={group} onChange={(e) => setGroup(e.target.value as 'item' | 'person')} aria-label="Групування">
          <option value="item">Групувати: за виробами</option>
          <option value="person">Групувати: за відповідальними</option>
        </select>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Відповідальний">
          <option value="">Усі відповідальні</option>
          {assigneeOpts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={orderFilter}
          onChange={(e) => setParams((p) => {
            const n = new URLSearchParams(p);
            if (e.target.value) n.set('pOrder', e.target.value);
            else n.delete('pOrder');
            return n;
          })}
          aria-label="Замовлення"
        >
          <option value="">Усі замовлення</option>
          {(data?.orders ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              №{o.num} · {o.clientName}
            </option>
          ))}
        </select>
        <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Етап">
          <option value="">Усі етапи</option>
          {PLAN_STAGES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <label className="chk">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Показувати виконані
        </label>
        <span className="grow" />
        {!!unplanned.length && (
          <button type="button" className="btn sm" onClick={() => setShowUnpl((v) => !v)}>
            {unplanned.length} етапів без кількості днів {showUnpl ? '▴' : '▾'}
          </button>
        )}
      </div>
      {showUnpl && !!unplanned.length && (
        <div className="panel" style={{ padding: '4px 14px', marginBottom: 12 }}>
          <div className="list">
            {unplanned.map((t) => (
              <div className="li" key={t.id} style={{ cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => setOpen(t)} onKeyDown={(e) => e.key === 'Enter' && setOpen(t)}>
                <div className="m">
                  №{t.orderNum} · {t.itemName} · {t.stage}
                  <small>{t.assigneeName ?? '—'}</small>
                </div>
                <span className="btn sm">Вказати дні</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="gantt" ref={scroller}>
        <div className="g-in" style={{ width: W }}>
          <div className="g-head">
            <div className="g-left">{group === 'person' ? 'Відповідальний / виріб' : 'Виріб / хто і скільки днів'}</div>
            <div className="g-days" style={{ width: NDAYS * DW }}>
              {mons}
              {days}
            </div>
          </div>
          <div className="g-body">
            {overlay}
            {groups.length ? (
              groups.map((g) => [group === 'person' ? personHead(g.rows) : itemHead(g.rows), ...g.rows.map(row)])
            ) : (
              <div className="empty" style={{ position: 'sticky', left: 0, width: 'min(100%, 600px)' }}>
                Немає етапів із запланованими днями. План створюється разом із виробом, а відповідальні вказують кількість днів.
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Дні календарні. Етапи кожного виробу: Прорахунок → Замір → Конструктив → Збірка → Монтаж. Кожен етап починається, коли закінчується
        попередній, якщо дату початку не вказано вручну. Якщо етап прострочено, наступні зсуваються від сьогодні.
      </p>
      {open && (
        <TaskModal
          task={open}
          prev={open.sched.prevId ? byId.get(open.sched.prevId) : null}
          title={`№${open.orderNum} · ${open.clientName}`}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
