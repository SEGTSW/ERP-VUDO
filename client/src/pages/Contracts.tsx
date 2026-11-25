import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONTRACT_KINDS, CONTRACT_STATUSES, FILE_EXTENSIONS, MAX_FILE_MB, fmtDate } from '@vudo/shared';
import { api, errorText } from '../api';
import { ConfirmButton, Modal, WarnBox } from '../ui/common';
import { RowLink, XlButton } from '../ui/bits';
import { useToast } from '../ui/toast';

interface Entity {
  id: number;
  name: string;
}
interface Contract {
  id: number;
  entityId: number;
  kind: string;
  counterparty: string;
  responsible: string;
  subject: string;
  amountText: string;
  num: string;
  signedOn: string | null;
  endsText: string;
  status: string;
  original: string;
  origin: string;
  note: string;
  scanUrl: string | null;
  archived: boolean;
  files: { id: number; name: string; createdAt: string; byName: string | null }[];
}

const ACCEPT = FILE_EXTENSIONS.map((e) => `.${e}`).join(',');

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['contracts', 'log']) void qc.invalidateQueries({ queryKey: [k] });
  };
}

/** Реєстр договорів та інших документів за юрособами (лише власник). */
export function Contracts() {
  const toast = useToast();
  const refresh = useRefresh();
  const q = useQuery({ queryKey: ['contracts'], queryFn: () => api.get<{ entities: Entity[]; rows: Contract[] }>('/contracts') });
  const [sel, setSel] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [archived, setArchived] = useState(false);
  const [edit, setEdit] = useState<number | 'new' | null>(null);
  const [rename, setRename] = useState<Entity | null>(null);
  const imp = useRef<HTMLInputElement>(null);
  const ents = q.data?.entities ?? [];
  const ent = ents.find((e) => e.id === sel) ?? ents[0];
  const all = q.data?.rows ?? [];
  const s = text.trim().toLowerCase();
  const rows = all.filter(
    (r) =>
      r.entityId === ent?.id &&
      r.archived === archived &&
      (!kind || r.kind === kind) &&
      (!status || r.status === (status === '-' ? '' : status)) &&
      (!s || `${r.counterparty} ${r.subject} ${r.num} ${r.note} ${r.responsible}`.toLowerCase().includes(s)),
  );
  const current = typeof edit === 'number' ? all.find((r) => r.id === edit) : null;
  const upload = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.append('files', f, f.name);
      return api.upload<{ added: number; duplicates: number }>(`/contracts/import/${ent!.id}`, form);
    },
    onSuccess: (r) => {
      refresh();
      toast(`Додано ${r.added}, уже були ${r.duplicates}`);
    },
    onError: (e) => toast(errorText(e), true),
    onSettled: () => imp.current && (imp.current.value = ''),
  });
  return (
    <>
      <div className="bar">
        <h1 className="grow">Договори і документи</h1>
        <XlButton section="contracts" />
      </div>
      <div className="subtabs" style={{ marginBottom: 14 }}>
        {ents.map((e) => (
          <button key={e.id} type="button" aria-current={e.id === ent?.id} onClick={() => setSel(e.id)}>
            {e.name} <small className="muted">{all.filter((r) => r.entityId === e.id && !r.archived).length}</small>
          </button>
        ))}
        {ent && (
          <button type="button" title="Змінити назву" aria-label="Змінити назву" onClick={() => setRename(ent)}>
            ✎
          </button>
        )}
      </div>
      <div className="bar">
        <input placeholder="Пошук: контрагент, предмет, номер" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 180 }} aria-label="Пошук" />
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Вид">
          <option value="">Усі документи</option>
          {CONTRACT_KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус">
          <option value="">Усі статуси</option>
          <option>Діючий</option>
          <option>Завершений</option>
          <option value="-">не вказано</option>
        </select>
        <label className="chk">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Архів
        </label>
        <label className="btn" style={{ cursor: 'pointer' }}>
          {upload.isPending ? 'Імпорт…' : 'Імпорт з Excel'}
          <input ref={imp} type="file" accept=".xlsx" hidden disabled={upload.isPending || !ent} onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
        </label>
        <button type="button" className="btn pri" disabled={!ent} onClick={() => setEdit('new')}>
          + Документ
        </button>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead>
            <tr>
              <th>Контрагент</th>
              <th>Предмет</th>
              <th>Сума</th>
              <th>Номер</th>
              <th>Підписано</th>
              <th>Завершення</th>
              <th>Статус</th>
              <th>Оригінал</th>
              <th>Файли</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <RowLink key={r.id} onOpen={() => setEdit(r.id)}>
                <td>
                  {r.counterparty}
                  {r.responsible && <small className="muted" style={{ display: 'block' }}>відповідальний: {r.responsible}</small>}
                </td>
                <td>
                  {r.subject}
                  {r.kind !== 'договір' && <small className="muted" style={{ display: 'block' }}>{r.kind}</small>}
                </td>
                <td>{r.amountText}</td>
                <td>{r.num}</td>
                <td className="num">{fmtDate(r.signedOn)}</td>
                <td>{r.endsText}</td>
                <td>{r.status ? <span className={`pill ${r.status === 'Діючий' ? 'g-work' : 'g-done'}`}>{r.status}</span> : '—'}</td>
                <td>{r.original || '—'}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {r.files.map((f) => (
                    <a key={f.id} className="lnk" style={{ display: 'block' }} href={`/api/contracts/files/${f.id}`} target="_blank" rel="noreferrer">
                      {f.name}
                    </a>
                  ))}
                  {r.scanUrl && (
                    <a className="lnk" href={r.scanUrl} target="_blank" rel="noreferrer">
                      скан ↗
                    </a>
                  )}
                </td>
              </RowLink>
            ))}
          </tbody>
        </table>
        {q.isPending && <div className="empty">Завантаження…</div>}
        {q.isError && <div className="warnbox">{errorText(q.error)}</div>}
        {q.isSuccess && !rows.length && <div className="empty">Документів немає. Натисніть «+ Документ».</div>}
      </div>
      {(edit === 'new' || current) && ent && (
        <ContractModal key={edit} item={current ?? null} entities={ents} entityId={ent.id} onCreated={setEdit} onClose={() => setEdit(null)} />
      )}
      {rename && <RenameModal ent={rename} onClose={() => setRename(null)} />}
    </>
  );
}

function RenameModal({ ent, onClose }: { ent: Entity; onClose: () => void }) {
  const refresh = useRefresh();
  const [name, setName] = useState(ent.name);
  const [err, setErr] = useState('');
  const save = useMutation({
    mutationFn: () => api.patch(`/contracts/entities/${ent.id}`, { name }),
    onSuccess: () => (refresh(), onClose()),
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <Modal onClose={onClose} onSubmit={() => save.mutate()} labelledBy="ent-title">
      <h2 id="ent-title">Назва</h2>
      <label className="f">
        Юрособа / ФОП / фізособа
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <WarnBox>{err}</WarnBox>
      <div className="act">
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

function ContractModal({
  item,
  entities,
  entityId,
  onCreated,
  onClose,
}: {
  item: Contract | null;
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
    kind: item?.kind ?? 'договір',
    counterparty: item?.counterparty ?? '',
    responsible: item?.responsible ?? '',
    subject: item?.subject ?? '',
    amountText: item?.amountText ?? '',
    num: item?.num ?? '',
    signedOn: item?.signedOn ?? '',
    endsText: item?.endsText ?? '',
    status: item?.status ?? '',
    original: item?.original ?? '',
    origin: item?.origin ?? '',
    note: item?.note ?? '',
    scanUrl: item?.scanUrl ?? '',
  });
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState<File[]>([]);
  const sendFiles = (id: number, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    return api.upload(`/contracts/${id}/files`, form);
  };
  const save = useMutation({
    mutationFn: async () => {
      const body = { ...v, signedOn: v.signedOn || null, scanUrl: v.scanUrl || null };
      if (item) {
        await api.put(`/contracts/${item.id}`, body);
        return { uploadError: '' };
      }
      const { id } = await api.post<{ id: number }>('/contracts', body);
      if (!picked.length) return { uploadError: '' };
      try {
        await sendFiles(id, picked);
        return { uploadError: '' };
      } catch (e) {
        // Картку вже створено — відкриваємо її, щоб повторити лише завантаження файлів
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
    mutationFn: (id: number) => api.del(`/contracts/files/${id}`),
    onSuccess: () => (refresh(), toast('Файл видалено')),
    onError: (e) => setErr(errorText(e)),
  });
  const arch = useMutation({
    mutationFn: () => api.patch(`/contracts/${item!.id}/archive`, { archived: !item!.archived }),
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
  const field = (k: 'counterparty' | 'responsible' | 'subject' | 'amountText' | 'num' | 'endsText' | 'original' | 'origin' | 'scanUrl', label: string, ph = '') => (
    <label className="f">
      {label}
      <input value={v[k]} placeholder={ph} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </label>
  );
  return (
    <Modal onClose={onClose} onSubmit={() => (v.counterparty.trim() ? save.mutate() : setErr('Вкажіть контрагента.'))} labelledBy="con-title">
      <h2 id="con-title">{item ? item.counterparty : 'Новий документ'}</h2>
      <div className="grid">
        <label className="f">
          Сторона
          <select value={v.entityId} onChange={(e) => setV({ ...v, entityId: Number(e.target.value) })}>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="f">
          Вид
          <select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
            {CONTRACT_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        {field('counterparty', 'Контрагент *')}
        {field('responsible', 'Відповідальний')}
        {field('subject', 'Предмет договору')}
        {field('amountText', 'Сума договору', '150 000 грн / за рахунками')}
        {field('num', 'Номер договору')}
        <label className="f">
          Дата підписання
          <input type="date" value={v.signedOn} onChange={(e) => setV({ ...v, signedOn: e.target.value })} />
        </label>
        {field('endsText', 'Дата завершення', '31.12.2026 / до повного виконання')}
        <label className="f">
          Діючий / завершений
          <select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
            {CONTRACT_STATUSES.map((x) => (
              <option key={x} value={x}>
                {x || '—'}
              </option>
            ))}
          </select>
        </label>
        {field('original', 'Наявність оригіналу')}
        {field('origin', 'Походження договору')}
        {field('scanUrl', 'Посилання на скан', 'https://…')}
      </div>
      <label className="f">
        Примітки (історія погодження)
        <textarea rows={4} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </label>
      <div className="sec">
        <div className="hd">
          <b>Файли</b>
          <label className="btn sm pri" style={{ cursor: 'pointer' }}>
            {add.isPending ? 'Завантаження…' : '+ Прикріпити'}
            <input ref={input} type="file" multiple hidden accept={ACCEPT} disabled={add.isPending} onChange={(e) => pick(e.target.files)} />
          </label>
        </div>
        {(item?.files ?? []).map((f) => (
          <div className="li" key={f.id}>
            <div className="m">
              <a className="lnk" href={`/api/contracts/files/${f.id}`} target="_blank" rel="noreferrer">
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
