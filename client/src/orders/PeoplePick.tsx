import { useEffect, useRef } from 'react';
import type { Role } from '@vudo/shared';
import type { Person } from '../types';

/** Активні люди з роллю + уже вибрані (навіть якщо вимкнені). Вільного тексту для людей немає. */
export function peopleWith(people: Person[], roles: Role[], keep: (number | null | undefined)[] = []) {
  return people.filter((u) => u.roles.some((r) => roles.includes(r)) && (!u.disabled || keep.includes(u.id)));
}

export function PersonSelect({
  people,
  roles,
  value,
  onChange,
  empty = '— не вибрано —',
  id,
}: {
  people: Person[];
  roles: Role[];
  value: number | null;
  onChange: (v: number | null) => void;
  empty?: string | null;
  id?: string;
}) {
  const list = peopleWith(people, roles, [value]);
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {empty != null && <option value="">{empty}</option>}
      {list.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
}

/** Монтажники: випадний список з галочками, у полі — імена через кому. */
export function InstallersPick({ people, value, onChange }: { people: Person[]; value: number[]; onChange: (v: number[]) => void }) {
  const list = peopleWith(people, ['Монтажник'], value);
  const ref = useRef<HTMLDetailsElement>(null);
  // Закрити список кліком поза ним
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const names = value.map((id) => people.find((u) => u.id === id)?.name).filter(Boolean);
  return (
    <details className="msel" ref={ref}>
      <summary>{names.length ? names.join(', ') : '— не вибрано —'}</summary>
      <div className="msel-p">
        {list.length ? (
          list.map((u) => (
            <label className="chk" key={u.id}>
              <input
                type="checkbox"
                checked={value.includes(u.id)}
                onChange={(e) => onChange(e.target.checked ? [...value, u.id] : value.filter((x) => x !== u.id))}
              />{' '}
              {u.name}
            </label>
          ))
        ) : (
          <span className="muted">Немає працівників з роллю «Монтажник» — додайте в Налаштуваннях.</span>
        )}
      </div>
    </details>
  );
}
