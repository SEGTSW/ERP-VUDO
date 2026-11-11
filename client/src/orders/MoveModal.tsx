import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { kyivToday, moveFields, type Status } from '@vudo/shared';
import { api, errorText } from '../api';
import type { OfficeCard } from '../types';
import { Modal, WarnBox } from '../ui/common';
import { useToast } from '../ui/toast';
import { usePeople } from './hooks';
import { InstallersPick, PersonSelect } from './PeoplePick';

export interface MoveDefaults {
  address?: string | null;
  measureDate?: string | null;
  measurerId?: number | null;
  installDate?: string | null;
  installerIds?: number[];
}

/** Вікно переходу в статус з обов'язковими полями (ТЗ розділ 4). Без полів — перехід одразу після «Підтвердити». */
export function MoveModal({
  orderId,
  num,
  from,
  to,
  mode,
  defaults,
  onClose,
}: {
  orderId: number;
  num: string;
  from: Status;
  to: Status;
  mode: 'step' | 'jump';
  defaults: MoveDefaults;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const people = usePeople().data ?? [];
  const fields = moveFields(from, to);
  const [v, setV] = useState({
    address: defaults.address ?? '',
    measureDate: defaults.measureDate ?? kyivToday(),
    measurerId: defaults.measurerId ?? null,
    installDate: defaults.installDate ?? '',
    installerIds: defaults.installerIds ?? [],
    ok: false,
    refuseReason: '',
    claimText: '',
    claimFix: '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    for (const f of fields) {
      const val = v[f.key];
      const empty = f.kind === 'check' ? !val : f.kind === 'installers' ? !(val as number[]).length : !val || !String(val).trim();
      if (empty) return setErr(f.kind === 'check' ? `Підтвердьте: ${f.label.toLowerCase()}.` : `Заповніть поле «${f.label}».`);
    }
    const values = Object.fromEntries(fields.map((f) => [f.key, v[f.key]]));
    setBusy(true);
    try {
      const card = await api.post<OfficeCard>(`/orders/${orderId}/status`, { to, mode, values });
      qc.setQueryData(['order', orderId], card);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['log'] });
      toast(`№${num}: «${to}»`);
      onClose();
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} onSubmit={submit} labelledBy="move-title">
      <h2 id="move-title">
        №{num}: «{from}» → «{to}»
      </h2>
      {fields.map((f) => {
        switch (f.kind) {
          case 'check':
            return (
              <label className="chk" key={f.key}>
                <input type="checkbox" checked={v.ok} onChange={(e) => setV({ ...v, ok: e.target.checked })} /> {f.label}
              </label>
            );
          case 'area':
            return (
              <label className="f" key={f.key}>
                {f.label} *
                <textarea value={v[f.key as 'refuseReason'] as string} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
              </label>
            );
          case 'measurer':
            return (
              <label className="f" key={f.key}>
                {f.label} *
                <PersonSelect people={people} roles={['Замірник']} value={v.measurerId} empty="— виберіть —" onChange={(x) => setV({ ...v, measurerId: x })} />
              </label>
            );
          case 'installers':
            return (
              <div className="f" key={f.key}>
                {f.label} *
                <InstallersPick people={people} value={v.installerIds} onChange={(x) => setV({ ...v, installerIds: x })} />
              </div>
            );
          default:
            return (
              <label className="f" key={f.key}>
                {f.label} *
                <input
                  type={f.kind === 'date' ? 'date' : 'text'}
                  value={v[f.key as 'address'] as string}
                  onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                />
              </label>
            );
        }
      })}
      {!fields.length && <div className="note">Перевести замовлення в «{to}»?</div>}
      <WarnBox>{err}</WarnBox>
      <div className="act">
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={busy}>
          Підтвердити
        </button>
      </div>
    </Modal>
  );
}
