import { useState } from 'react';
import { ALL_STATUSES, CLAIM, REFUSAL, fmtDate, money, moveFields, nextStatuses, statusGroup, statusIndex, switchAllowed, type Status } from '@vudo/shared';
import { api } from '../api';
import type { ExecCard, OfficeCard } from '../types';
import { Drawer, StatusPill, SubTabs } from '../ui/bits';
import { useDrawer, useOrderAction, useOrderCard } from './hooks';
import { MoveModal } from './MoveModal';
import { MainTab } from './tabs/MainTab';
import { ItemsTab } from './tabs/ItemsTab';
import { ExactTab } from './tabs/ExactTab';
import { FilesTab, visibleFileCount } from './tabs/FilesTab';
import { PayTab } from './tabs/PayTab';
import { PlanTab } from './tabs/PlanTab';
import { CommentsTab } from './tabs/CommentsTab';
import { ExecInfoTab, ExecItemsTab } from './tabs/ExecTabs';
import { IssueModal, OrderTopBlocks } from './Issues';

/** Картка замовлення — панель справа поверх будь-якого розділу. */
export function OrderDrawer({ id }: { id: number }) {
  const { close } = useDrawer();
  const q = useOrderCard(id);
  return (
    <Drawer onClose={close} label={q.data ? `Замовлення ${q.data.num}` : 'Замовлення'}>
      {q.isPending && <div className="db">Завантаження…</div>}
      {q.isError && (
        <div className="db">
          <div className="warnbox">Не вдалося відкрити замовлення: {q.error.message}</div>
          <div>
            <button type="button" className="btn" onClick={close}>
              Закрити
            </button>
          </div>
        </div>
      )}
      {q.data?.view === 'office' && <OfficeOrder o={q.data} />}
      {q.data?.view === 'exec' && <ExecOrder o={q.data} />}
    </Drawer>
  );
}

type OfficeTab = 'main' | 'items' | 'exact' | 'files' | 'pay' | 'plan' | 'com' | 'hist';

function OfficeOrder({ o }: { o: OfficeCard }) {
  const { close, tab, setTab } = useDrawer();
  const [move, setMove] = useState<{ to: Status; mode: 'step' | 'jump' } | null>(null);
  const exactDone = o.items.filter((i) => i.calc.exactCost != null).length;
  const tabs: [OfficeTab, string][] = [
    ['main', 'Загальне'],
    ['items', `Попередній прорахунок (${o.items.length})`],
    ['exact', `Точний прорахунок${o.items.length ? ` (${exactDone}/${o.items.length})` : ''}`],
    ['files', `Файли (${visibleFileCount(o.files, true)})`],
    ['pay', `Оплати (${o.payments.length})`],
    ['plan', `План (${o.tasks.length})`],
    ['com', `Коментарі (${o.comments.length})`],
    ['hist', 'Історія'],
  ];
  const cur = (tabs.some((t) => t[0] === tab) ? tab : 'main') as OfficeTab;
  const s = o.sums;

  const direct = useOrderAction(
    o.id,
    (v: { to: Status; mode: 'step' | 'jump' }) => api.post<OfficeCard>(`/orders/${o.id}/status`, { ...v, values: {} }),
    (v) => `№${o.num}: «${v.to}»`,
  );

  /** Перехід: з вікном, якщо цільовий статус має обов'язкові поля (назад — без вікна). */
  function go(to: Status, mode: 'step' | 'jump') {
    if (to === o.status) return;
    const back = mode === 'jump' && statusIndex(to) > 0 && statusIndex(o.status) > 0 && statusIndex(to) < statusIndex(o.status);
    if (!back && moveFields(o.status, to).length) setMove({ to, mode });
    else direct.mutate({ to, mode });
  }

  const moves = nextStatuses(o.status);
  return (
    <>
      <div className="dh">
        <div className="t">
          <div style={{ minWidth: 0 }}>
            <div className="muted num" style={{ fontSize: 12 }}>
              Замовлення №{o.num} · створено {fmtDate(o.createdDate)}
            </div>
            <h1>{o.client.name}</h1>
            <div className="muted num" style={{ fontSize: 13 }}>
              {o.client.phone}
              {o.address ? ` · ${o.address}` : ''}
            </div>
          </div>
          <div className="st-sw">
            <label className="f">
              Статус
              <select
                className={`g-${statusGroup(o.status)}`}
                value={o.status}
                disabled={direct.isPending}
                onChange={(e) => go(e.target.value as Status, 'jump')}
              >
                {ALL_STATUSES.map((x) => (
                  <option key={x} value={x} disabled={(x === REFUSAL || x === CLAIM) && x !== o.status && !switchAllowed(o.status, x)}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn sm" onClick={close} aria-label="Закрити">
              ✕
            </button>
          </div>
        </div>
        <div className="moves">
          <StatusPill s={o.status} /> <span className="muted" style={{ fontSize: 12 }}>з {fmtDate(o.statusSince)}</span>
          {!!o.late && <span className="late">прострочено на {o.late} дн.</span>}
          {o.archived && <span className="chip">в архіві</span>}
        </div>
        {!!moves.length && (
          <div className="moves">
            <span className="lbl">Перевести в:</span>
            {moves.map((t) => (
              <button key={t} type="button" className={`btn sm ${t === REFUSAL || t === CLAIM ? 'warn' : 'pri'}`} disabled={direct.isPending} onClick={() => go(t, 'step')}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="db">
        <OrderTopBlocks issues={o.issues} reserved={o.reserved} />
        <div className="sums">
          <div>
            <small>Ціна</small>
            <b>{money(s.price)}</b>
            {(o.delivery > 0 || s.discount > 0) && (
              <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.3 }}>
                вироби {money(s.items)}
                {o.delivery > 0 ? ` + доставка ${money(o.delivery)}` : ''}
                {s.discount > 0 ? ` − знижка ${money(s.discount)}` : ''}
              </span>
            )}
          </div>
          <div>
            <small>Оплачено</small>
            <b>{money(s.paid)}</b>
          </div>
          <div>
            <small>Борг</small>
            <b className={s.debt > 0 ? 'debt' : ''}>{money(s.debt)}</b>
          </div>
          <div>
            <small>Собівартість</small>
            <b>{money(s.cost)}</b>
          </div>
          {s.designer > 0 && (
            <div>
              <small>Дизайнеру</small>
              <b>{money(s.designer)}</b>
            </div>
          )}
          {o.owner && (
            <>
              <div>
                <small>Маржа (план)</small>
                <b>
                  {money(o.owner.margin)}{' '}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {s.price ? `${Math.round(o.owner.marginPct)}%` : ''}
                  </span>
                </b>
              </div>
              <div>
                <small>Чистий прибуток</small>
                <b className={o.owner.netProfit < 0 ? 'debt' : ''}>
                  {money(o.owner.netProfit)}{' '}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {s.price ? `${Math.round(o.owner.netPct)}%` : ''}
                  </span>
                </b>
              </div>
            </>
          )}
        </div>
        {o.status === REFUSAL && <div className="warnbox">Відмова. Причина: {o.refuseReason}</div>}
        {o.status === CLAIM && <div className="warnbox">Рекламація: {o.claimText}</div>}
        <SubTabs tabs={tabs} cur={cur} onChange={setTab} />
        {cur === 'main' && <MainTab o={o} />}
        {cur === 'items' && <ItemsTab o={o} onExact={() => setTab('exact')} />}
        {cur === 'exact' && <ExactTab o={o} />}
        {cur === 'files' && <FilesTab id={o.id} files={o.files} office designer={o.designer} isDesign={o.source === 'дизайнер'} />}
        {cur === 'pay' && <PayTab o={o} />}
        {cur === 'plan' && <PlanTab orderId={o.id} num={o.num} clientName={o.client.name} tasks={o.tasks} items={o.items} />}
        {cur === 'com' && <CommentsTab id={o.id} comments={o.comments} />}
        {cur === 'hist' && (
          <div className="sec">
            <h2>Історія змін</h2>
            <div className="list">
              {o.history.map((h) => (
                <div className="li" key={h.id}>
                  <div className="m">
                    {h.text}
                    <small>{h.byName}</small>
                  </div>
                  <small className="num" style={{ whiteSpace: 'nowrap' }}>
                    {new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' }).format(new Date(h.at))}
                  </small>
                </div>
              ))}
              {!o.history.length && <div className="empty">Змін ще немає.</div>}
            </div>
          </div>
        )}
      </div>
      {move && (
        <MoveModal
          orderId={o.id}
          num={o.num}
          from={o.status}
          to={move.to}
          mode={move.mode}
          defaults={{ address: o.address, measureDate: o.measureDate, measurerId: o.measurerId, installDate: o.installDate, installerIds: o.installerIds }}
          onClose={() => setMove(null)}
        />
      )}
    </>
  );
}

type ExecTab = 'main' | 'items' | 'files' | 'plan' | 'com';

/** 5.5 Картка для виконавців: лише перегляд, без сум; файли й коментарі можна додавати. */
function ExecOrder({ o }: { o: ExecCard }) {
  const { close, tab, setTab } = useDrawer();
  const tabs: [ExecTab, string][] = [
    ['main', 'Інформація'],
    ['items', `Вироби (${o.items.length})`],
    ['files', `Файли (${visibleFileCount(o.files, false)})`],
    ['plan', `План (${o.tasks.length})`],
    ['com', `Коментарі (${o.comments.length})`],
  ];
  const cur = (tabs.some((t) => t[0] === tab) ? tab : 'main') as ExecTab;
  const mine = [...new Set(o.myStages)];
  const [issue, setIssue] = useState(false);
  return (
    <>
      <div className="dh">
        <div className="t">
          <div style={{ minWidth: 0 }}>
            <div className="muted num" style={{ fontSize: 12 }}>
              Замовлення №{o.num} · створено {fmtDate(o.createdDate)}
            </div>
            <h1>{o.client.name}</h1>
            <div className="muted num" style={{ fontSize: 13 }}>
              {o.client.phone}
              {o.address ? ` · ${o.address}` : ''}
            </div>
          </div>
          <button type="button" className="btn sm" onClick={close} aria-label="Закрити">
            ✕
          </button>
        </div>
        <div className="moves">
          <StatusPill s={o.status} /> <span className="muted" style={{ fontSize: 12 }}>з {fmtDate(o.statusSince)}</span>
          {!!mine.length && <span className="chip">мої етапи: {mine.map((x) => x.toLowerCase()).join(', ')}</span>}
          <span style={{ marginLeft: 'auto' }}>
            <button type="button" className="btn sm" onClick={() => setIssue(true)}>
              ⚠ Не вистачає / брак
            </button>
          </span>
        </div>
      </div>
      <div className="db">
        <OrderTopBlocks issues={o.issues} reserved={o.reserved} />
        {o.claimText && <div className="warnbox">Рекламація: {o.claimText}</div>}
        <SubTabs tabs={tabs} cur={cur} onChange={setTab} />
        {cur === 'main' && <ExecInfoTab o={o} />}
        {cur === 'items' && <ExecItemsTab o={o} />}
        {cur === 'files' && <FilesTab id={o.id} files={o.files} office={false} designer={o.designer} isDesign={!!o.designer} />}
        {cur === 'plan' && <PlanTab orderId={o.id} num={o.num} clientName={o.client.name} tasks={o.tasks} items={o.items} />}
        {cur === 'com' && <CommentsTab id={o.id} comments={o.comments} />}
      </div>
      {issue && <IssueModal orderId={o.id} num={o.num} clientName={o.client.name} items={o.items} onClose={() => setIssue(false)} />}
    </>
  );
}
