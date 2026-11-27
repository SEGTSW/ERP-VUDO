import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONTRACT_STORAGE, FILE_EXTENSIONS, MAX_FILE_MB, PRIMARY_DIRECTIONS, PRIMARY_KINDS, PRIMARY_PAY, fmtDate, kop } from '@vudo/shared';
import { api, errorText } from '../api';
import { ConfirmButton, Modal, NumberField, WarnBox } from '../ui/common';
import { RowLink } from '../ui/bits';
import { useToast } from '../ui/toast';

interface Entity {
  id: number;
  name: string;
}
interface Doc {
  id: number;
  entityId: number;
  kind: string;
  direction: string;
  num: string;
  docDate: string | null;
  counterparty: string;
  subject: string;
  amount: number | null;
  payStatus: string;
  storage: string;
  location: string;
  note: string;
  archived: boolean;
  files: { id: number; name: string; createdAt: string; byName: string | null }[];
}

const ACCEPT = ['image/*', ...FILE_EXTENSIONS.map((e) => `.${e}`)].join(',');
const PAY_PILL: Record<string, string> = { 'Оплачено': 'g-done', 'Частково': 'g-work', 'Не оплачено': 'g-bad' };

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['primary-docs', 'log']) void qc.invalidateQueries({ queryKey: [k] });
  };
}

/** Документи → «Первинні документи»: реєстр рахунків, накладних, актів та інших документів по ТОВ і ФОП. */
export function PrimaryDocs() {
  const q = useQuery({ queryKey: ['primary-docs'], queryFn: () => api.get<{ entities: Entity[]; rows: Doc[] }>('/primary-docs') });
  const [sel, setSel] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [kind, setKind] = useState('');
  const [dir, setDir] = useState('');
  const [pay, setPay] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [archived, setArchived] = useState(false);
  const [edit, setEdit] = useState<number | 'new' | null>(null);
  const ents = q.data?.entities ?? [];
  const ent = ents.find((e) => e.id === sel) ?? ents[0];
  const all = q.data?.rows ?? [];
  const s = text.trim().toLowerCase();
  const rows = all.filter(
    (r) =>
      r.entityId === ent?.id &&
      r.archived === archived &&
      (!kind || r.kind === kind) &&
      (!dir || r.direction === dir) &&
      (!pay || r.payStatus === (pay === '-' ? '' : pay)) &&
      (!from || (r.docDate ?? '') >= from) &&
      (!to || (!!r.docDate && r.docDate <= to)) &&
      (!s || `${r.counterparty} ${r.subject} ${r.num} ${r.note} ${r.location}`.toLowerCase().includes(s)),
  );
  const sum = (d: string) => rows.filter((r) => r.direction === d).reduce((t, r) => t + (r.amount ?? 0), 0);
  const current = typeof edit === 'number' ? all.find((r) => r.id === edit) : null;
  return (
    <>
      <div className="seg" style={{ marginBottom: 12 }}>
        {ents.map((e) => (
          <button key={e.id} type="button" aria-current={e.id === ent?.id} onClick={() => setSel(e.id)}>
            {e.name} <small className="muted">{all.filter((r) => r.entityId === e.id && !r.archived).length}</small>
          </button>
        ))}
      </div>
      <div className="bar">
        <input placeholder="Пошук: контрагент, зміст, номер, де лежить" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 180 }} aria-label="Пошук" />
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Вид">
          <option value="">Усі види</option>
          {PRIMARY_KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select value={dir} onChange={(e) => setDir(e.target.value)} aria-label="Вхідні / вихідні">
          <option value="">Вхідні й вихідні</option>
          {PRIMARY_DIRECTIONS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select value={pay} onChange={(e) => setPay(e.target.value)} aria-label="Оплата">
          <option value="">Будь-яка оплата</option>
          {PRIMARY_PAY.filter(Boolean).map((k) => (
            <option key={k}>{k}</option>
          ))}
          <option value="-">не вказано</option>
        </select>
        <label className="chk">
          з <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Дата від" />
        </label>
        <label className="chk">
          по <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Дата по" />
        </label>
        <label className="chk">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Архів
        </label>
        <button type="button" className="btn pri" disabled={!ent} onClick={() => setEdit('new')}>
          + Документ
        </button>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Документ</th>
              <th>Контрагент</th>
              <th>Зміст</th>
              <th className="r">Сума</th>
              <th>Оплата</th>
              <th>Де зберігається</th>
              <th>Файли</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <RowLink key={r.id} onOpen={() => setEdit(r.id)}>
                <td className="num">{fmtDate(r.docDate) || '—'}</td>
                <td>
                  {r.kind}
                  {r.num && ` №${r.num.replace(/^№\s*/, '')}`}
                  <small className="muted" style={{ display: 'block' }}>{r.direction === 'Вхідний' ? 'вхідний (від контрагента)' : 'вихідний (виписали ми)'}</small>
                </td>
                <td>{r.counterparty}</td>
                <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>{r.subject}</td>
                <td className="r num">{r.amount == null ? '—' : kop(r.amount)}</td>
                <td>{r.payStatus ? <span className={`pill ${PAY_PILL[r.payStatus]}`}>{r.payStatus}</span> : '—'}</td>
                <td>
                  {r.storage || (r.location ? '' : '—')}
                  {r.location && <small className="muted" style={{ display: 'block' }}>{r.location}</small>}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  {r.files.map((f) => (
                    <a key={f.id} className="lnk" style={{ display: 'block' }} href={`/api/primary-docs/files/${f.id}`} target="_blank" rel="noreferrer">
                      {f.name}
                    </a>
                  ))}
                </td>
              </RowLink>
            ))}
          </tbody>
        </table>
        {q.isPending && <div className="empty">Завантаження…</div>}
        {q.isError && <div className="warnbox">{errorText(q.error)}</div>}
        {q.isSuccess && !rows.length && <div className="empty">Документів немає. Натисніть «+ Документ».</div>}
      </div>
      {!!rows.length && (
        <div className="note" style={{ marginTop: 10 }}>
          Документів: {rows.length} · вхідні: {kop(sum('Вхідний'))} грн · вихідні: {kop(sum('Вихідний'))} грн
        </div>
      )}
      {(edit === 'new' || current) && ent && (
        <DocModal key={edit} item={current ?? null} entities={ents} entityId={ent.id} onCreated={setEdit} onClose={() => setEdit(null)} />
      )}
    </>
  );
}

function DocModal({
  item,
  entities,
  entityId,
  onCreated,
  onClose,
}: {
  item: Doc | null;
  entities: Entity[];
  entityId: number;
  onCreated: (id: number) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const refresh = useRefresh();
  const input = useRef<HTMLInputElement>(null);
  const [v, setV] = useState({
    entityId: item?.entityId ?? entityId,
    kind: item?.kind ?? 'Рахунок',
    direction: item?.direction ?? 'Вхідний',
    num: item?.num ?? '',
    docDate: item?.docDate ?? '',
    counterparty: item?.counterparty ?? '',
    subject: item?.subject ?? '',
    amount: item?.amount ?? null,
    payStatus: item?.payStatus ?? '',
    storage: item?.storage ?? '',
    location: item?.location ?? '',
    note: item?.note ?? '',
  });
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState<File[]>([]);
  const sendFiles = (id: number, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    return api.upload(`/primary-docs/${id}/files`, form);
  };
  const save = useMutation({
    mutationFn: async () => {
      const body = { ...v, docDate: v.docDate || null };
      if (item) {
        await api.put(`/primary-docs/${item.id}`, body);
        return { uploadError: '' };
      }
      const { id } = await api.post<{ id: number }>('/primary-docs', body);
      if (!picked.length) return { uploadError: '' };
      try {
        await sendFiles(id, picked);
        return { uploadError: '' };
      } catch (e) {
        return { uploadError: errorText(e), id };
      }
    },
    onSuccess: (r) => {
      refresh();
      if (r.uploadError) {
        toast(`Документ збережено, файли не додано: ${r.uploadError}`, true);
        if ('id' in r && r.id) return onCreated(r.id);
      } else toast('Збережено');
      onClose();
    },
    onError: (e) => setErr(errorText(e)),
  });
  const add = useMutation({
    mutationFn: (files: File[]) => sendFiles(item!.id, files),
    onSuccess: () => (refresh(), toast('Файл додано')),
    onError: (e) => setErr(errorText(e)),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/primary-docs/files/${id}`),
    onSuccess: () => (refresh(), toast('Файл видалено')),
    onError: (e) => setErr(errorText(e)),
  });
  const arch = useMutation({
    mutationFn: () => api.patch(`/primary-docs/${item!.id}/archive`, { archived: !item!.archived }),
    onSuccess: () => (refresh(), onClose()),
    onError: (e) => setErr(errorText(e)),
  });
  function pick(list: FileList | null) {
    const files = [...(list ?? [])];
    const big = files.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    const ok = files.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024);
    if (big.length) toast(`Більше ${MAX_FILE_MB} МБ, не додано: ${big.map((f) => f.name).join(', ')}`, true);
    if (ok.length) item ? add.mutate(ok) : setPicked([...picked, ...ok]);
    if (input.current) input.current.value = '';
  }
  const field = (k: 'num' | 'counterparty' | 'location', label: string, ph = '') => (
    <label className="f">
      {label}
      <input value={v[k]} placeholder={ph} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </label>
  );
  const select = (k: 'entityId' | 'kind' | 'direction' | 'payStatus' | 'storage', label: string, opts: readonly (readonly [string | number, string])[]) => (
    <label className="f">
      {label}
      <select value={v[k]} onChange={(e) => setV({ ...v, [k]: k === 'entityId' ? Number(e.target.value) : e.target.value })}>
        {opts.map(([val, l]) => (
          <option key={val} value={val}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  const same = (xs: readonly string[]) => xs.map((x) => [x, x || '—'] as const);
  return (
    <Modal onClose={onClose} onSubmit={() => (v.counterparty.trim() ? save.mutate() : setErr('Вкажіть контрагента.'))} labelledBy="pd-title">
      <h2 id="pd-title">{item ? `${item.kind}${item.num ? ` №${item.num.replace(/^№\s*/, '')}` : ''}` : 'Новий первинний документ'}</h2>
      <div className="grid">
        {select('entityId', 'Чий документ', entities.map((e) => [e.id, e.name] as const))}
        {select('kind', 'Вид', same(PRIMARY_KINDS))}
        {select('direction', 'Вхідний / вихідний', [
          ['Вхідний', 'Вхідний — отримали від контрагента'],
          ['Вихідний', 'Вихідний — виписали ми'],
        ])}
        {field('num', 'Номер')}
        <label className="f">
          Дата документа
          <input type="date" value={v.docDate} onChange={(e) => setV({ ...v, docDate: e.target.value })} />
        </label>
        {field('counterparty', 'Контрагент *', 'Віяр, ТОВ «…»')}
        <label className="f">
          Сума, грн
          <NumberField value={v.amount} placeholder="0,00" onCommit={(x) => setV({ ...v, amount: x })} />
        </label>
        {select('payStatus', 'Оплата', same(PRIMARY_PAY))}
        {select('storage', 'Зберігання', same(CONTRACT_STORAGE))}
        {field('location', 'Де зберігається', v.storage === 'Електронно' ? 'Google Drive / Рахунки 2026' : 'Офіс, шафа 1, папка «Накладні»')}
      </div>
      <label className="f">
        Зміст (за що)
        <textarea rows={2} value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />
      </label>
      <label className="f">
        Примітки
        <textarea rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </label>
      <div className="sec">
        <div className="hd">
          <b>Файли (скан, PDF)</b>
          <label className="btn sm pri" style={{ cursor: 'pointer' }}>
            {add.isPending ? 'Завантаження…' : '+ Прикріпити'}
            <input ref={input} type="file" multiple hidden accept={ACCEPT} disabled={add.isPending} onChange={(e) => pick(e.target.files)} />
          </label>
        </div>
        {(item?.files ?? []).map((f) => (
          <div className="li" key={f.id}>
            <div className="m">
              <a className="lnk" href={`/api/primary-docs/files/${f.id}`} target="_blank" rel="noreferrer">
                {f.name}
              </a>
              <small>
                {fmtDate(f.createdAt)} · {f.byName}
              </small>
            </div>
            <ConfirmButton className="mini" onConfirm={() => del.mutate(f.id)}>
              ✕
            </ConfirmButton>
          </div>
        ))}
        {picked.map((f, i) => (
          <div className="li" key={i}>
            <div className="m">
              {f.name}
              <small>додасться після збереження</small>
            </div>
            <button type="button" className="mini" onClick={() => setPicked(picked.filter((_, k) => k !== i))}>
              ✕
            </button>
          </div>
        ))}
        {!item?.files.length && !picked.length && <div className="muted">Файлів ще немає.</div>}
      </div>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        {item && (
          <button type="button" className="btn warn" style={{ marginRight: 'auto' }} onClick={() => arch.mutate()}>
            {item.archived ? 'Повернути з архіву' : 'В архів'}
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Закрити
        </button>
        <button type="submit" className="btn pri" disabled={save.isPending}>
          Зберегти
        </button>
      </div>
    </Modal>
  );
}
