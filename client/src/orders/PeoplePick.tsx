import { useEffect, useRef } from 'react';
import type { Role } from '@vudo/shared';
import type { Person } from '../types';

/** Активні люди з роллю + уже вибрані (навіть якщо вимкнені або роль знято — щоб їх було видно і можна прибрати). Вільного тексту для людей немає. */
export function peopleWith(people: Person[], roles: Role[], keep: (number | null | undefined)[] = []) {
  return people.filter((u) => keep.includes(u.id) || (u.roles.some((r) => roles.includes(r)) && !u.disabled));
}

/** Ім'я з позначкою, якщо вибрана людина вже не має потрібної ролі або доступ вимкнено. */
const label = (u: Person, roles: Role[]) =>
  !u.roles.some((r) => roles.includes(r)) ? `${u.name} (роль знято)` : u.disabled ? `${u.name} (вимкнено)` : u.name;

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
          {label(u, roles)}
        </option>
      ))}
    </select>
  );
}

/** Кілька людей з роллю (монтажники, конструктори): випадний список з галочками, у полі — імена через кому. */
export function MultiPick({ people, role, value, onChange }: { people: Person[]; role: Role; value: number[]; onChange: (v: number[]) => void }) {
  const list = peopleWith(people, [role], value);
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
              {label(u, [role])}
            </label>
          ))
        ) : (
          <span className="muted">Немає працівників з роллю «{role}» — додайте в Налаштуваннях.</span>
        )}
      </div>
    </details>
  );
}
