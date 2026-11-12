import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { money } from '@vudo/shared';
import { api } from '../api';
import { kmoney } from '../ui/bits';

interface Row {
  name: string;
  leads: number;
  won: number;
  conv: number | null;
  sum: number;
  marginPct?: number | null;
}

interface StatsData {
  label: string;
  leads: number;
  wonCount: number;
  wonSum: number;
  avg: number;
  margin?: number;
  marginPct?: number | null;
  conv: number | null;
  lost: number;
  months: { key: string; label: string; y: number; n: number; v: number }[];
  sources: Row[];
  managers: Row[];
  types: { type: string; n: number; sum: number; marginPct?: number | null }[];
  reasons: { reason: string; n: number }[];
  leadToContract: number | null;
  contractToInstall: number | null;
}

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}%`);
const dword = (n: number) => {
  const a = n % 10;
  const b = n % 100;
  return a === 1 && b !== 11 ? 'день' : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? 'дні' : 'днів';
};
const Meter = ({ v, max }: { v: number; max: number }) => (
  <span className="meter">
    <i style={{ width: `${Math.max(2, (v / Math.max(1, max)) * 100)}%` }} />
  </span>
);

/** Стовпчики за 12 місяців: один колір, поточний насиченіший, значення над найбільшим і поточним; підказка при наведенні. */
function Chart({ months }: { months: StatsData['months'] }) {
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null);
  const W = 1000;
  const H = 240;
  const L = 56;
  const B = 30;
  const T = 14;
  const mx = Math.max(1, ...months.map((m) => m.v));
  const p = 10 ** Math.floor(Math.log10(mx));
  const nice = [1, 2, 2.5, 5, 10].map((k) => k * p).find((v) => v >= mx) ?? 10 * p;
  const cw = (W - L - 26) / 12;
  const bw = Math.min(40, cw - 12);
  const Y = (v: number) => H - B - (v / nice) * (H - B - T);
  const iMax = months.reduce((a, m, i) => (m.v > months[a]!.v ? i : a), 0);
  return (
    <div className="chartwrap" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="achart" role="img" aria-label="Сума договорів по місяцях">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - 8} y1={Y(f * nice)} y2={Y(f * nice)} className="grid" />
            <text x={L - 8} y={Y(f * nice) + 4} textAnchor="end" className="tk">
              {kmoney(f * nice)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const x = L + i * cw + (cw - bw) / 2;
          const text = `${m.label} ${m.y}: ${money(m.v)} · договорів ${m.n}`;
          return (
            <g key={m.key} className={`bar ${tip?.text === text ? 'on' : ''}`} onMouseEnter={() => setTip({ x: ((x + bw / 2) / W) * 100, text })}>
              <rect x={L + i * cw} y={T} width={cw} height={H - B - T} fill="transparent" />
              {m.v > 0 && <rect x={x} y={Y(m.v)} width={bw} height={H - B - Y(m.v)} rx={4} className={`bm ${i === 11 ? 'last' : ''}`} />}
              {m.v > 0 && (i === iMax || i === 11) && (
                <text x={x + bw / 2} y={Y(m.v) - 6} textAnchor="middle" className="vl">
                  {kmoney(m.v)}
                </text>
              )}
              <text x={x + bw / 2} y={H - 10} textAnchor="middle" className="tk">
                {m.label}
              </text>
            </g>
          );
        })}
        <line x1={L} x2={W - 8} y1={H - B} y2={H - B} className="axis" />
      </svg>
      {tip && (
        <div className="tip" style={{ left: `${tip.x}%`, top: 0, transform: 'translateX(-50%)' }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

/** 11. Аналітика. */
export function Stats() {
  const [period, setPeriod] = useState<'month' | 'quarter' | 'year' | 'all'>('year');
  const q = useQuery({ queryKey: ['stats', period], queryFn: () => api.get<StatsData>(`/stats?period=${period}`) });
  const d = q.data;
  const owner = d?.margin !== undefined;
  return (
    <>
      <div className="bar">
        <h1 className="grow">Аналітика</h1>
        <div className="seg">
          {(
            [
              ['month', 'Місяць'],
              ['quarter', 'Квартал'],
              ['year', 'Рік'],
              ['all', 'Усе'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" aria-current={period === k} onClick={() => setPeriod(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {q.isPending && <div className="empty">Завантаження…</div>}
      {d && (
        <>
          <div className="kpis">
            <div className="kpi">
              <small>Звернень</small>
              <b>{d.leads}</b>
              <span>{d.label}</span>
            </div>
            <div className="kpi">
              <small>Договорів</small>
              <b>{money(d.wonSum)}</b>
              <span>{d.wonCount} шт.</span>
            </div>
            <div className="kpi">
              <small>Середній чек</small>
              <b>{money(d.avg)}</b>
              <span>за договором</span>
            </div>
            {owner && (
              <div className="kpi">
                <small>Маржа</small>
                <b>{money(d.margin!)}</b>
                <span>{d.marginPct != null ? `${Math.round(d.marginPct)}% від продажів` : '—'}</span>
              </div>
            )}
            <div className="kpi">
              <small>Конверсія</small>
              <b>{pct(d.conv)}</b>
              <span>звернення → договір · відмов {d.lost}</span>
            </div>
          </div>
          <div className="sec" style={{ marginBottom: 14 }}>
            <div className="hd">
              <h2>Договори по місяцях, грн</h2>
              <small className="muted">останні 12 місяців · наведіть на стовпчик</small>
            </div>
            <Chart months={d.months} />
          </div>
          <div className="agrid">
            <div className="sec">
              <h2>Звідки клієнти</h2>
              <div className="tbl-wrap flat">
                <table className="tsm">
                  <thead>
                    <tr>
                      <th>Джерело</th>
                      <th className="r">Звернень</th>
                      <th className="r">Договорів</th>
                      <th className="r">Конверсія</th>
                      <th>Сума договорів</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.sources.map((e) => (
                      <tr key={e.name}>
                        <td>{e.name}</td>
                        <td className="r num">{e.leads}</td>
                        <td className="r num">{e.won}</td>
                        <td className="r num">{pct(e.conv)}</td>
                        <td>
                          <div className="mcell">
                            <Meter v={e.sum} max={Math.max(...d.sources.map((x) => x.sum))} />
                            <span className="num">{money(e.sum)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!d.sources.length && (
                      <tr>
                        <td colSpan={5} className="muted">
                          Немає даних за період.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="sec">
              <h2>Менеджери</h2>
              <div className="tbl-wrap flat">
                <table className="tsm">
                  <thead>
                    <tr>
                      <th>Менеджер</th>
                      <th className="r">Звернень</th>
                      <th className="r">Договорів</th>
                      <th className="r">Конверсія</th>
                      <th className="r">Сума</th>
                      {owner && <th className="r">Маржа</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {d.managers.map((e) => (
                      <tr key={e.name}>
                        <td>{e.name}</td>
                        <td className="r num">{e.leads}</td>
                        <td className="r num">{e.won}</td>
                        <td className="r num">{pct(e.conv)}</td>
                        <td className="r num">{money(e.sum)}</td>
                        {owner && <td className="r num">{pct(e.marginPct)}</td>}
                      </tr>
                    ))}
                    {!d.managers.length && (
                      <tr>
                        <td colSpan={6} className="muted">
                          Немає даних за період.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="sec">
              <h2>Що продаємо</h2>
              <div className="tbl-wrap flat">
                <table className="tsm">
                  <thead>
                    <tr>
                      <th>Тип виробу</th>
                      <th className="r">Шт.</th>
                      <th>Сума</th>
                      {owner && <th className="r">Маржа</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {d.types.map((t) => (
                      <tr key={t.type}>
                        <td>{t.type}</td>
                        <td className="r num">{t.n}</td>
                        <td>
                          <div className="mcell">
                            <Meter v={t.sum} max={Math.max(...d.types.map((x) => x.sum))} />
                            <span className="num">{money(t.sum)}</span>
                          </div>
                        </td>
                        {owner && <td className="r num">{pct(t.marginPct)}</td>}
                      </tr>
                    ))}
                    {!d.types.length && (
                      <tr>
                        <td colSpan={4} className="muted">
                          Немає договорів за період.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <small className="muted">Сума — ціни виробів без доставки і знижок.</small>
            </div>
            <div className="sec">
              <h2>Відмови і терміни</h2>
              <div className="list">
                {d.reasons.map((r) => (
                  <div className="li" key={r.reason}>
                    <div className="m">{r.reason}</div>
                    <b className="num" style={{ fontWeight: 500 }}>
                      {r.n}
                    </b>
                  </div>
                ))}
                {!d.reasons.length && <div className="muted">Відмов за період немає.</div>}
              </div>
              <div className="sums">
                <div>
                  <small>Звернення → договір</small>
                  <b>{d.leadToContract != null ? `${d.leadToContract} ${dword(d.leadToContract)}` : '—'}</b>
                </div>
                <div>
                  <small>Договір → монтаж</small>
                  <b>{d.contractToInstall != null ? `${d.contractToInstall} ${dword(d.contractToInstall)}` : '—'}</b>
                </div>
              </div>
            </div>
          </div>
          <div className="note" style={{ marginTop: 14 }}>
            Аналітика рахує всі замовлення, разом з архівом. Договір зараховується в місяць підписання, за ціною договору; відмова — за датою переходу в
            «Відмова».
          </div>
        </>
      )}
    </>
  );
}
