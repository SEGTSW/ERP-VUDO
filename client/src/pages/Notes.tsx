import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { LOG_FOLDERS, fmtDateTime, folderLabel, isOwner, isOffice, type LogFolder } from '@vudo/shared';
import { api } from '../api';
import { useMe } from '../session';
import { useDrawer } from '../orders/hooks';
import type { LogPage } from '../types';

type FolderKey = LogFolder | 'all';

/** Повідомлення та журнал змін (ТЗ розділ 12). */
export function Notes() {
  const { user } = useMe();
  const owner = isOwner(user);
  const office = isOffice(user);
  const qc = useQueryClient();
  const { openOrder } = useDrawer();
  const [folder, setFolder] = useState<FolderKey>('all');

  // Виконавці не бачать папки «Фінанси» взагалі; у менеджера вона називається «Оплати».
  const folders = useMemo(
    () =>
      [['all', 'Усі'] as const, ...LOG_FOLDERS.filter(([k]) => office || k !== 'fin').map(([k]) => [k, folderLabel(k, owner)] as const)],
    [office, owner],
  );

  const q = useInfiniteQuery({
    queryKey: ['log', 'list', folder],
    queryFn: ({ pageParam }) => api.get<LogPage>(`/log?folder=${folder}${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.entries.at(-1)?.id : undefined),
  });

  const first = q.data?.pages[0];
  const topId = first?.entries[0]?.id;
  const counters = first?.counters;

  // Відкриття папки позначає побачені записи прочитаними.
  useEffect(() => {
    if (!topId) return;
    api
      .post('/log/read', { folder, upTo: topId })
      .then(() => qc.invalidateQueries({ queryKey: ['log', 'unread'] }))
      .catch(() => {});
  }, [folder, topId, qc]);

  const entries = q.data?.pages.flatMap((p) => p.entries) ?? [];
  const count = (k: FolderKey) => {
    if (!counters) return { n: 0, total: 0 };
    const keys = k === 'all' ? (Object.keys(counters) as LogFolder[]) : [k];
    return keys.reduce((a, x) => ({ n: a.n + (counters[x]?.new ?? 0), total: a.total + (counters[x]?.total ?? 0) }), { n: 0, total: 0 });
  };

  return (
    <>
      <div className="bar">
        <h1 className="grow">Повідомлення та журнал змін</h1>
      </div>
      <div className="nf-wrap">
        <nav className="nf" aria-label="Папки">
          {folders.map(([k, l]) => {
            const c = count(k);
            return (
              <button key={k} type="button" aria-current={folder === k} onClick={() => setFolder(k)}>
                <span className="lbl">{l}</span>
                {c.n ? <span className="badge">{c.n}</span> : <small className="muted num">{c.total || ''}</small>}
              </button>
            );
          })}
        </nav>
        <div className="panel" style={{ padding: '4px 16px', minWidth: 0 }}>
          <div className="list feed">
            {q.isPending && <div className="empty">Завантаження…</div>}
            {q.isError && <div className="empty">Не вдалося завантажити. Оновіть сторінку.</div>}
            {q.isSuccess && !entries.length && <div className="empty">У цій папці поки порожньо.</div>}
            {entries.map((e) => (
              <div className="li" key={e.id}>
                <div className="m">
                  {e.isNew && <b style={{ color: 'var(--accent)' }}>● </b>}
                  {e.orderId && e.orderNum && (
                    <>
                      <a
                        href={`?order=${e.orderId}`}
                        className="lnk"
                        onClick={(ev) => {
                          ev.preventDefault();
                          openOrder(e.orderId!);
                        }}
                      >
                        №{e.orderNum}
                      </a>{' '}
                      ·{' '}
                    </>
                  )}
                  {e.text}
                  <small>
                    {e.userName}
                    {folder === 'all' ? ` · ${folderLabel(e.folder, owner)}` : ''}
                  </small>
                </div>
                <small className="num" style={{ whiteSpace: 'nowrap' }}>
                  {fmtDateTime(e.at)}
                </small>
              </div>
            ))}
          </div>
          {q.hasNextPage && (
            <div style={{ padding: '10px 0', textAlign: 'center' }}>
              <button type="button" className="btn sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                {q.isFetchingNextPage ? 'Завантаження…' : 'Показати ще'}
              </button>
            </div>
          )}
        </div>
      </div>
      {!owner && (
        <div className="note" style={{ marginTop: 12 }}>
          {office
            ? 'Фінансову звітність (облік, P&L, витрати, прибуток, виплати) бачить лише власник; вам видно оплати, прорахунки і ціни.'
            : 'Фінансові записи бачать лише менеджери й власники.'}
        </div>
      )}
    </>
  );
}
