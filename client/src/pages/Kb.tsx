import { useDeferredValue, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtDate, fmtDateTime, isOffice } from '@vudo/shared';
import { api, errorText } from '../api';
import { useMe } from '../session';
import { ConfirmButton, Modal, WarnBox } from '../ui/common';
import { mb } from '../ui/bits';
import { useToast } from '../ui/toast';

const CATS = ['Компанія', 'Клієнт', 'Регламенти', 'Шаблони і документи', 'Навчання'] as const;

interface KbItem {
  id: number;
  title: string;
  cat: string;
  body: string;
  vis: 'all' | 'office';
  pinned: boolean;
  draft: boolean;
  updatedAt: string;
  byName: string | null;
  files?: number;
  readAt: string | null;
  reads?: number;
  audience?: number;
}

interface KbArticle extends Omit<KbItem, 'files'> {
  files: { id: number; name: string; size: number; createdAt: string; byName: string | null }[];
  readers: { id: number; name: string; readAt: string | null }[] | null;
}

/** Простий текст без розмітки — для прев'ю. */
const plain = (t: string) => t.replace(/^\s*([-•]|\d+[.)])\s+/gm, '').replace(/[#*_]/g, '').replace(/\s+/g, ' ').trim();

/** Розмітка: «# Заголовок», «## Підзаголовок», «- пункт», «1. пункт», **жирний**, _курсив_. Безпечно — без HTML з тексту. */
function inline(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|(^|\s)_(.+?)_(?=\s|$|[.,!?])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    out.push(s.slice(last, m.index + (m[2]?.length ?? 0)));
    out.push(m[1] != null ? <b key={`${key}-${k++}`}>{m[1]}</b> : <em key={`${key}-${k++}`}>{m[3]}</em>);
    last = re.lastIndex;
  }
  out.push(s.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list.type;
    const items = list.items.map((x, i) => <li key={i}>{inline(x, `l${blocks.length}-${i}`)}</li>);
    blocks.push(L === 'ul' ? <ul key={blocks.length}>{items}</ul> : <ol key={blocks.length}>{items}</ol>);
    list = null;
  };
  for (const raw of text.split('\n')) {
    const l = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (/^##\s+/.test(l)) (flush(), blocks.push(<h4 key={blocks.length}>{inline(l.replace(/^##\s+/, ''), `h${blocks.length}`)}</h4>));
    else if (/^#\s+/.test(l)) (flush(), blocks.push(<h3 key={blocks.length}>{inline(l.replace(/^#\s+/, ''), `h${blocks.length}`)}</h3>));
    else if ((m = l.match(/^[-•]\s+(.*)/))) {
      if (list?.type !== 'ul') (flush(), (list = { type: 'ul', items: [] }));
      list!.items.push(m[1]!);
    } else if ((m = l.match(/^\d+[.)]\s+(.*)/))) {
      if (list?.type !== 'ol') (flush(), (list = { type: 'ol', items: [] }));
      list!.items.push(m[1]!);
    } else if (!l.trim()) flush();
    else (flush(), blocks.push(<p key={blocks.length}>{inline(l, `p${blocks.length}`)}</p>));
  }
  flush();
  return <div className="kb-body">{blocks}</div>;
}

function useRefreshKb() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['kb', 'kb-unread', 'log']) void qc.invalidateQueries({ queryKey: [k] });
  };
}

/** 12Б База знань. */
export function Kb() {
  const { user } = useMe();
  const office = isOffice(user);
  const [cat, setCat] = useState('');
  const [text, setText] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [edit, setEdit] = useState<KbItem | KbArticle | 'new' | null>(null);
  const q = useDeferredValue(text.trim().toLowerCase());
  const list = useQuery({ queryKey: ['kb', 'list'], queryFn: () => api.get<KbItem[]>('/kb') });
  const all = list.data ?? [];
  if (openId) return <Article id={openId} onBack={() => setOpenId(null)} onEdit={(a) => setEdit(a)} editModal={edit && <KbModal item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDeleted={() => setOpenId(null)} />} />;
  const cats = CATS.filter((c) => office || all.some((a) => a.cat === c));
  const shown = all
    .filter((a) => (!cat || a.cat === cat) && (!q || `${a.title} ${a.body}`.toLowerCase().includes(q)))
    .sort((a, b) => CATS.indexOf(a.cat as never) - CATS.indexOf(b.cat as never) || a.title.localeCompare(b.title, 'uk'));
  const pins = all.filter((a) => a.pinned);
  const unread = (a: KbItem) => !a.draft && !a.readAt;
  return (
    <>
      <div className="bar">
        <h1 className="grow">База знань</h1>
        {office && (
          <button type="button" className="btn pri" onClick={() => setEdit('new')}>
            + Матеріал
          </button>
        )}
      </div>
      {!cat && !q && !!pins.length && (
        <div className="kb-pins">
          {pins.map((a) => (
            <div key={a.id} className="kb-pin" role="button" tabIndex={0} onClick={() => setOpenId(a.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(a.id)}>
              <small>{a.cat}</small>
              <b>{a.title}</b>
              <span>{plain(a.body).slice(0, 180)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="kb-wrap">
        <nav className="nf" aria-label="Розділи">
          <button type="button" aria-current={!cat} onClick={() => setCat('')}>
            <span className="lbl">Усе</span>
            <span className="muted">{all.length}</span>
          </button>
          {cats.map((c) => {
            const n = all.filter((a) => a.cat === c).length;
            const un = all.filter((a) => a.cat === c && unread(a)).length;
            return (
              <button key={c} type="button" aria-current={cat === c} onClick={() => setCat(c)}>
                <span className="lbl">{c}</span>
                {un ? <span className="badge">{un}</span> : <span className="muted">{n}</span>}
              </button>
            );
          })}
        </nav>
        <div>
          <div className="bar">
            <input placeholder="Пошук у базі знань" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1 }} aria-label="Пошук" />
          </div>
          <div className="kb-list">
            {shown.map((a) => (
              <div key={a.id} className="kb-it" role="button" tabIndex={0} onClick={() => setOpenId(a.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(a.id)}>
                {unread(a) ? <span className="kb-dot" title="не прочитано" /> : <span style={{ width: 8, flex: 'none' }} />}
                <div className="m">
                  <b>{a.title}</b> {a.draft && <span className="chip draft">чернетка</span>}
                  {a.vis === 'office' && <span className="chip"> лише офіс</span>}
                  {!!a.files && <span className="chip"> файлів: {a.files}</span>}
                  <small>
                    {a.cat} · оновлено {fmtDate(a.updatedAt)} · {a.byName}
                  </small>
                  <small style={{ marginTop: 3, color: 'var(--fg)', opacity: 0.75 }}>{plain(a.body).slice(0, 140)}</small>
                </div>
                {office && a.audience != null && (
                  <small className="num">
                    {a.reads}/{a.audience}
                  </small>
                )}
              </div>
            ))}
            {list.isPending && <div className="empty">Завантаження…</div>}
            {list.isSuccess && !shown.length && <div className="empty">Нічого не знайдено.</div>}
          </div>
        </div>
      </div>
      <div className="note" style={{ marginTop: 12 }}>
        Тут зберігаються місія, візія, цінності, дорожня карта клієнта, регламенти, шаблони і навчальні матеріали. Кожен працівник бачить нові
        матеріали з позначкою і підтверджує «Ознайомився».{office ? ' Цифра справа — скільки людей уже ознайомились.' : ''}
      </div>
      {edit && <KbModal item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onCreated={(id) => setOpenId(id)} />}
    </>
  );
}

function Article({ id, onBack, onEdit, editModal }: { id: number; onBack: () => void; onEdit: (a: KbArticle) => void; editModal: ReactNode }) {
  const { user } = useMe();
  const office = isOffice(user);
  const toast = useToast();
  const refresh = useRefreshKb();
  const file = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['kb', id], queryFn: () => api.get<KbArticle>(`/kb/${id}`) });
  const read = useMutation({
    mutationFn: () => api.post(`/kb/${id}/read`),
    onSuccess: () => (refresh(), toast('Позначено: ознайомився')),
    onError: (e) => toast(errorText(e), true),
  });
  const upload = useMutation({
    mutationFn: (fs: File[]) => {
      const f = new FormData();
      for (const x of fs) f.append('files', x, x.name);
      return api.upload(`/kb/${id}/files`, f);
    },
    onSuccess: () => (refresh(), toast('Файл додано')),
    onError: (e) => toast(errorText(e), true),
  });
  const a = q.data;
  return (
    <>
      <div className="bar">
        <button type="button" className="btn sm" onClick={onBack}>
          ‹ База знань
        </button>
        <span className="grow" />
        {office && a && (
          <button type="button" className="btn" onClick={() => onEdit(a)}>
            Редагувати
          </button>
        )}
      </div>
      {q.isPending && <div className="empty">Завантаження…</div>}
      {q.isError && <div className="warnbox">Матеріал не знайдено.</div>}
      {a && (
        <article className="kb-art">
          <div>
            <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {a.cat}
              {a.vis === 'office' ? ' · лише офіс' : ''}
            </div>
            <h1 style={{ marginTop: 4 }}>
              {a.title} {a.draft && <span className="chip draft" style={{ verticalAlign: 'middle' }}>чернетка</span>}
            </h1>
            <div className="muted" style={{ fontSize: 13 }}>
              оновлено {fmtDate(a.updatedAt)} · {a.byName}
            </div>
          </div>
          <Markdown text={a.body} />
          <div className="sec" style={{ gap: 8 }}>
            <div className="hd">
              <h2>Файли ({a.files.length})</h2>
              {office && (
                <label className="btn sm" style={{ cursor: 'pointer' }}>
                  + Прикріпити
                  <input ref={file} type="file" multiple hidden onChange={(e) => (e.target.files?.length && upload.mutate([...e.target.files]), (e.target.value = ''))} />
                </label>
              )}
            </div>
            {a.files.length ? (
              <div className="list">
                {a.files.map((f) => (
                  <a key={f.id} className="li" href={`/api/kb-files/${f.id}`} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                    <div className="m">
                      {f.name}
                      <small>
                        {fmtDate(f.createdAt)} · {f.byName}
                      </small>
                    </div>
                    <small className="num">{mb(f.size)}</small>
                  </a>
                ))}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 13 }}>
                Файлів немає.{office ? ' Можна прикріпити оригінал (PDF, DOCX, презентацію).' : ''}
              </div>
            )}
          </div>
          {!a.draft &&
            (a.readAt ? (
              <span className="okbox" style={{ alignSelf: 'flex-start' }}>
                ✓ Ви ознайомились {fmtDateTime(a.readAt)}
              </span>
            ) : (
              <div>
                <button type="button" className="btn pri" disabled={read.isPending} onClick={() => read.mutate()}>
                  Ознайомився ✓
                </button>
              </div>
            ))}
          {a.readers && (
            <div className="sec" style={{ gap: 6 }}>
              <h2>
                Ознайомились: {a.readers.filter((r) => r.readAt).length} з {a.readers.length}
              </h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {a.readers.map((r) => (
                  <span key={r.id} className="chip" style={r.readAt ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined} title={r.readAt ? `ознайомився ${fmtDateTime(r.readAt)}` : 'ще ні'}>
                    {r.readAt ? '✓ ' : ''}
                    {r.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </article>
      )}
      {editModal}
    </>
  );
}

function KbModal({ item, onClose, onCreated, onDeleted }: { item: KbItem | KbArticle | null; onClose: () => void; onCreated?: (id: number) => void; onDeleted?: () => void }) {
  const toast = useToast();
  const refresh = useRefreshKb();
  const [v, setV] = useState({
    title: item?.title ?? '',
    cat: item?.cat ?? 'Компанія',
    body: item?.body ?? '',
    vis: item?.vis ?? 'all',
    pinned: item?.pinned ?? false,
    draft: item?.draft ?? false,
    rereq: false,
  });
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => (item ? api.patch(`/kb/${item.id}`, v) : api.post<{ id: number }>('/kb', v)),
    onSuccess: (r) => {
      refresh();
      toast('Збережено');
      onClose();
      if (!item && r && typeof r === 'object' && 'id' in r) onCreated?.((r as { id: number }).id);
    },
    onError: (e) => setErr(errorText(e)),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/kb/${item!.id}`),
    onSuccess: () => (refresh(), toast('Видалено'), onClose(), onDeleted?.()),
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal onClose={onClose} onSubmit={() => (v.title.trim() ? save.mutate() : setErr('Вкажіть назву.'))} labelledBy="kb-title">
      <h2 id="kb-title">{item ? 'Редагувати матеріал' : 'Новий матеріал'}</h2>
      <div className="grid">
        <label className="f">
          Назва *
          <input value={v.title} placeholder="Місія, Регламент заміру…" onChange={(e) => setV({ ...v, title: e.target.value })} />
        </label>
        <label className="f">
          Розділ
          <select value={v.cat} onChange={(e) => setV({ ...v, cat: e.target.value })}>
            {CATS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="f">
          Хто бачить
          <select value={v.vis} onChange={(e) => setV({ ...v, vis: e.target.value as 'all' | 'office' })}>
            <option value="all">Усі працівники</option>
            <option value="office">Лише менеджери і власник</option>
          </select>
        </label>
      </div>
      <label className="f">
        Текст
        <textarea value={v.body} style={{ minHeight: 280, fontSize: 14, lineHeight: 1.5 }} onChange={(e) => setV({ ...v, body: e.target.value })} />
      </label>
      <div className="note"># Заголовок · ## Підзаголовок · - пункт списку · 1. нумерований · **жирний**. Можна вставити текст з Word — абзаци збережуться. Оригінал файлу прикріпіть після збереження.</div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <label className="chk">
          <input type="checkbox" checked={v.pinned} onChange={(e) => setV({ ...v, pinned: e.target.checked })} /> Закріпити зверху (як місію, візію)
        </label>
        <label className="chk">
          <input type="checkbox" checked={v.draft} onChange={(e) => setV({ ...v, draft: e.target.checked })} /> Чернетка (не просити ознайомитись)
        </label>
        {item && (
          <label className="chk">
            <input type="checkbox" checked={v.rereq} onChange={(e) => setV({ ...v, rereq: e.target.checked })} /> Суттєві зміни — попросити всіх ознайомитись знову
          </label>
        )}
      </div>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        {item && (
          <span style={{ marginRight: 'auto' }}>
            <ConfirmButton disabled={del.isPending} onConfirm={() => del.mutate()}>
              Видалити
            </ConfirmButton>
          </span>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={save.isPending}>
          Зберегти
        </button>
      </div>
    </Modal>
  );
}
