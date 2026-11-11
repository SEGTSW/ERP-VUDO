import { useRef, useState } from 'react';
import { FILE_EXTENSIONS, MAX_FILE_MB, fmtDate } from '@vudo/shared';
import { api } from '../../api';
import type { OrderCard, OrderFile } from '../../types';
import { mb } from '../../ui/bits';
import { useToast } from '../../ui/toast';
import { useOrderAction } from '../hooks';

type Cat = OrderFile['category'];
const CATS: [Cat, string][] = [
  ['design', 'Дизайн-проєкт'],
  ['spec', 'Прорахунки / специфікації'],
  ['constr', 'Конструктив'],
  ['other', 'Інші файли'],
];
const HINT: Record<Cat, string> = {
  design: 'Файли від дизайнера: PDF, візуалізації, креслення, .dwg/.dxf/.skp/.3ds/.max, архіви.',
  spec: 'Прорахунки, специфікації матеріалів і фурнітури, КП.',
  constr: 'Креслення, деталювання, файли Базис / PRO100 / dwg.',
  other: 'Фото заміру, накидки, фото монтажу, файли з телеграму тощо.',
};
const ACCEPT = ['image/*', ...FILE_EXTENSIONS.map((e) => `.${e}`)].join(',');

/** Лічильник «Файли (N)»: виконавцям файли «Прорахунки / специфікації» не рахуються (і не передаються сервером). */
export const visibleFileCount = (files: OrderFile[], office: boolean) => files.filter((f) => office || f.category !== 'spec').length;

/** 6.4 Вкладка «Файли»: підвкладки з лічильниками; файл потрапляє в ту, де його додали. */
export function FilesTab({
  id,
  files,
  office,
  designer,
  isDesign,
}: {
  id: number;
  files: OrderFile[];
  office: boolean;
  designer: { name: string; company: string | null } | null;
  isDesign: boolean;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const cats = CATS.filter(([k]) => (k !== 'design' || isDesign || files.some((f) => f.category === 'design')) && (k !== 'spec' || office));
  const [sel, setSel] = useState<Cat>(cats[0]![0]);
  const cur = cats.some((c) => c[0] === sel) ? sel : cats[0]![0];
  const list = files.filter((f) => f.category === cur);

  const upload = useOrderAction(
    id,
    (picked: File[]) => {
      const form = new FormData();
      form.append('category', cur);
      for (const f of picked) form.append('files', f, f.name);
      return api.upload<OrderCard>(`/orders/${id}/files`, form);
    },
    (picked) => (picked.length > 1 ? `Додано файлів: ${picked.length}` : 'Файл додано'),
  );

  function pick(list: FileList | null) {
    if (!list?.length) return;
    const all = [...list];
    const big = all.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    const ok = all.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024);
    if (big.length) toast(`Більше ${MAX_FILE_MB} МБ, не додано: ${big.map((f) => f.name).join(', ')}`, true);
    if (ok.length) upload.mutate(ok);
    if (input.current) input.current.value = '';
  }

  return (
    <>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {cats.map(([k, l]) => (
          <button key={k} type="button" aria-current={cur === k} onClick={() => setSel(k)}>
            {l} <small>{files.filter((f) => f.category === k).length}</small>
          </button>
        ))}
      </div>
      <div className="sec">
        <div className="hd">
          <div>
            <h2>{CATS.find((c) => c[0] === cur)![1]}</h2>
            {cur === 'design' && (
              <small className="muted">{designer ? `від дизайнера «${designer.company ? `${designer.name} · ${designer.company}` : designer.name}»` : 'дизайнера не вибрано'}</small>
            )}
          </div>
          <label className="btn sm pri" style={{ cursor: 'pointer' }} aria-disabled={upload.isPending}>
            {upload.isPending ? 'Завантаження…' : '+ Прикріпити'}
            <input ref={input} type="file" multiple hidden accept={ACCEPT} disabled={upload.isPending} onChange={(e) => pick(e.target.files)} />
          </label>
        </div>
        {list.length ? (
          <div className="list">
            {list.map((f) => (
              <a key={f.id} className="li" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                <div className="m">
                  {f.name}
                  <small>
                    {fmtDate(f.createdAt)} · {f.byName}
                  </small>
                </div>
                {f.mime?.startsWith('image/') && f.mime !== 'image/svg+xml' && (
                  <img src={`/api/files/${f.id}`} alt="" loading="lazy" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }} />
                )}
                <small className="num">{mb(f.size)}</small>
              </a>
            ))}
          </div>
        ) : (
          <div className="empty" style={{ padding: 18 }}>
            {HINT[cur]} До {MAX_FILE_MB} МБ на файл.
          </div>
        )}
        {office && <div className="note">Вкладку «Прорахунки / специфікації» бачать лише менеджер і власник.</div>}
      </div>
    </>
  );
}
