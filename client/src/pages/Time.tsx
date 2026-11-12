import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TIME_CODES, kyivToday, parseTimeValue, timeTotals } from '@vudo/shared';
import { api, errorText } from '../api';
import { useToast } from '../ui/toast';
import { XlButton } from '../ui/bits';

interface TimeData {
  month: string;
  today: string;
  days: { date: string; n: number; w: number; weekend: boolean }[];
  users: { id: number; name: string; roles: string[]; disabled: boolean }[];
  values: Record<number, Record<string, string>>;
}

const MONTHS = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
const WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const shift = (m: string, k: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + k, 1));
  return d.toISOString().slice(0, 7);
};

/** 12В Табель: працівники × дні. Збереження — після виходу з клітинки; Tab — наступний день; підсумки — одразу. */
export function Time() {
  const qc = useQueryClient();
  const toast = useToast();
  const [month, setMonth] = useState(kyivToday().slice(0, 7));
  const q = useQuery({ queryKey: ['time', month], queryFn: () => api.get<TimeData>(`/time?month=${month}`) });
  // Локальні значення: введене не скидається під час набору, підсумки рахуються з них
  const [vals, setVals] = useState<Record<number, Record<string, string>>>({});
  useEffect(() => {
    if (q.data) setVals(q.data.values);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (v: { userId: number; date: string; value: string }) => api.put<{ value: string }>('/time', v),
    onError: (e) => {
      toast(errorText(e), true);
      void qc.invalidateQueries({ queryKey: ['time', month] });
    },
  });
  const fill = useMutation({
    mutationFn: () => api.post<{ filled: number }>('/time/fill', { month }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['time', month] });
      toast(r.filled ? `Заповнено клітинок: ${r.filled}` : 'Порожніх буднів немає');
    },
    onError: (e) => toast(errorText(e), true),
  });
  const d = q.data;
  const cur = kyivToday().slice(0, 7);
  const set = (u: number, date: string, v: string) => setVals((x) => ({ ...x, [u]: { ...(x[u] ?? {}), [date]: v } }));

  function commit(u: number, date: string, raw: string) {
    const before = q.data?.values[u]?.[date] ?? '';
    const v = parseTimeValue(raw);
    if (v == null) {
      toast('Години (0–24) або В, Л, ВП, П', true);
      set(u, date, before);
      return;
    }
    set(u, date, v);
    if (v !== before) save.mutate({ userId: u, date, value: v }, { onSuccess: () => q.data && ((q.data.values[u] ??= {})[date] = v) });
  }

  const totals = (u: number) => timeTotals(Object.values(vals[u] ?? {}).filter(Boolean));
  const all = (d?.users ?? []).map((u) => totals(u.id));
  const sum = (k: keyof ReturnType<typeof timeTotals>) => Math.round(all.reduce((t, x) => t + x[k], 0) * 100) / 100;
  const work = (d?.days ?? []).filter((x) => !x.weekend).length;

  return (
    <>
      <div className="bar">
        <h1 className="grow">Табель</h1>
        <XlButton section="time" params={{ month }} />
      </div>
      <div className="bar day-nav">
        <button type="button" className="btn sm" aria-label="Попередній місяць" onClick={() => setMonth(shift(month, -1))}>
          ‹
        </button>
        <b style={{ minWidth: 150, textAlign: 'center' }}>
          {MONTHS[Number(month.slice(5)) - 1]} {month.slice(0, 4)}
        </b>
        <button type="button" className="btn sm" aria-label="Наступний місяць" onClick={() => setMonth(shift(month, 1))}>
          ›
        </button>
        {month !== cur && (
          <button type="button" className="btn sm" onClick={() => setMonth(cur)}>
            Поточний місяць
          </button>
        )}
        <span className="grow" />
        <span className="muted" style={{ fontSize: 13 }}>
          Робочих днів (пн–пт): <b className="num">{work}</b> · норма <b className="num">{work * 8}</b> год
        </span>
        <button type="button" className="btn sm" disabled={fill.isPending} onClick={() => fill.mutate()}>
          Заповнити порожні будні по 8 год
        </button>
      </div>
      {q.isPending && <div className="empty">Завантаження…</div>}
      {d && (
        <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          <table className="ttime">
            <thead>
              <tr>
                <th className="nm">Працівник</th>
                <th>Днів</th>
                <th>Годин</th>
                <th>Лік.</th>
                <th>Відп.</th>
                <th className="sep">Прог.</th>
                {d.days.map((x) => (
                  <th key={x.date} className={`${x.weekend ? 'we' : ''} ${x.date === d.today ? 'td' : ''}`}>
                    {x.n}
                    <small>{WD[x.w]}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.users.map((u) => {
                const t = totals(u.id);
                return (
                  <tr key={u.id}>
                    <td className="nm">
                      {u.name}
                      <small>
                        {u.roles.join(', ')}
                        {u.disabled ? ' · вимкнено' : ''}
                      </small>
                    </td>
                    <td className="tot">{t.days}</td>
                    <td className="tot">
                      <b>{t.hours}</b>
                    </td>
                    <td className="tot">{t.sick || ''}</td>
                    <td className="tot">{t.vacation || ''}</td>
                    <td className={`tot sep ${t.absent ? 'debt' : ''}`}>{t.absent || ''}</td>
                    {d.days.map((x) => {
                      const v = vals[u.id]?.[x.date] ?? '';
                      return (
                        <td key={x.date} className={x.weekend ? 'we' : ''}>
                          <input
                            className={`tc ${TIME_CODES[v.toUpperCase()] ? `c-${v.toUpperCase()}` : ''}`}
                            value={v}
                            inputMode="decimal"
                            maxLength={4}
                            title={`${u.name}, ${x.n}.${month.slice(5)}`}
                            aria-label={`${u.name}, ${x.n}.${month.slice(5)}`}
                            onChange={(e) => set(u.id, x.date, e.target.value)}
                            onBlur={(e) => commit(u.id, x.date, e.target.value)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="nm">Разом</td>
                <td className="tot">{sum('days')}</td>
                <td className="tot">{sum('hours')}</td>
                <td className="tot">{sum('sick') || ''}</td>
                <td className="tot">{sum('vacation') || ''}</td>
                <td className="tot sep">{sum('absent') || ''}</td>
                {d.days.map((x) => (
                  <td key={x.date} className={x.weekend ? 'we' : ''} />
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="legend" style={{ marginTop: 10 }}>
        <span>У клітинку — кількість годин (8, 4, 7.5) або позначка:</span>
        {Object.entries(TIME_CODES).map(([k, l]) => (
          <span key={k}>
            <b className="num" style={{ width: 'auto', height: 'auto', background: 'none', fontWeight: 700 }}>
              {k}
            </b>{' '}
            {l}
          </span>
        ))}
        <span>Порожньо — не вказано.</span>
      </div>
      <div className="note" style={{ marginTop: 10 }}>
        Табель бачать і ведуть власник і менеджер. Він лише фіксує присутність і години — ставок і нарахувань тут немає. Зберігається автоматично після
        кожної клітинки (Tab — до наступного дня).
      </div>
    </>
  );
}
