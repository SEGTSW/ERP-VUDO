import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LOGIN_RE, MSG, PASSWORD_MIN, ROLES, ROLE_HINTS, normalizeLogin, type Role } from '@vudo/shared';
import { api, errorText } from '../api';
import { useMe } from '../session';
import type { User } from '../types';
import { ConfirmButton, Modal, WarnBox } from '../ui/common';
import { useToast } from '../ui/toast';

/** Налаштування → Користувачі (ТЗ 13.1). */
export function UsersSection() {
  const { user: me } = useMe();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') });
  const [edit, setEdit] = useState<User | 'new' | null>(null);

  return (
    <div className="sec">
      <div className="hd">
        <h2>Користувачі</h2>
        <button type="button" className="btn sm pri" onClick={() => setEdit('new')}>
          + Користувач
        </button>
      </div>
      <div className="tbl-wrap flat">
        <table className="tsm">
          <thead>
            <tr>
              <th>Ім'я</th>
              <th>Логін</th>
              <th>Ролі</th>
              <th>Доступ</th>
            </tr>
          </thead>
          <tbody>
            {q.isPending && (
              <tr>
                <td colSpan={4} className="muted">
                  Завантаження…
                </td>
              </tr>
            )}
            {q.data?.map((u) => (
              <tr
                key={u.id}
                onClick={() => setEdit(u)}
                onKeyDown={(e) => e.key === 'Enter' && setEdit(u)}
                tabIndex={0}
                style={{ cursor: 'pointer', ...(u.disabled ? { opacity: 0.55 } : {}) }}
              >
                <td>
                  {u.name}
                  {u.id === me.id && <small className="muted"> (це ви)</small>}
                  {u.phone && (
                    <small className="muted num" style={{ display: 'block' }}>
                      {u.phone}
                    </small>
                  )}
                </td>
                <td className="num">{u.login}</td>
                <td>{u.roles.join(', ')}</td>
                <td>{u.disabled ? <span className="pill g-bad">вимкнено</span> : <span className="pill g-done">активний</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note">
        Самореєстрації немає: акаунти створюють власник або менеджер і самі передають працівнику логін і пароль. Звільненому — «Вимкнути
        доступ»: він більше не зможе увійти, але його ім'я лишається в історії, планах і замовленнях.
      </div>
      {edit && <UserModal user={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function UserModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { user: me } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({
    name: user?.name ?? '',
    phone: user?.phone ?? '',
    login: user?.login ?? '',
    password: '',
    roles: (user?.roles ?? ['Менеджер']) as Role[],
  });
  const [err, setErr] = useState('');

  const done = (msg: string) => {
    void qc.invalidateQueries({ queryKey: ['users'] });
    void qc.invalidateQueries({ queryKey: ['log'] });
    toast(msg);
    onClose();
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { name: v.name, phone: v.phone, login: v.login, roles: v.roles, ...(v.password ? { password: v.password } : {}) };
      return user ? api.patch<User>(`/users/${user.id}`, body) : api.post<User>('/users', body);
    },
    onSuccess: (u) => done(user ? 'Збережено' : `Користувача створено. Логін: ${u.login}`),
    onError: (e) => setErr(errorText(e)),
  });

  const toggle = useMutation({
    mutationFn: () => api.patch<User>(`/users/${user!.id}`, { disabled: !user!.disabled }),
    onSuccess: (u) => done(u.disabled ? 'Доступ вимкнено' : 'Доступ увімкнено'),
    onError: (e) => setErr(errorText(e)),
  });

  const submit = () => {
    const login = normalizeLogin(v.login);
    const e = !v.name.trim()
      ? MSG.nameRequired
      : !LOGIN_RE.test(login)
        ? MSG.loginRule
        : !v.roles.length
          ? MSG.rolesRequired
          : (!user && v.password.length < PASSWORD_MIN) || (v.password && v.password.length < PASSWORD_MIN)
            ? MSG.passwordRule
            : '';
    if (e) return setErr(e);
    setErr('');
    save.mutate();
  };

  const setRole = (r: Role, on: boolean) => setV({ ...v, roles: on ? [...v.roles, r] : v.roles.filter((x) => x !== r) });

  return (
    <Modal onClose={onClose} onSubmit={submit} labelledBy="user-modal-title">
      <h2 id="user-modal-title">{user ? 'Користувач' : 'Новий користувач'}</h2>
      <div className="grid">
        <label className="f">
          Ім'я та прізвище *
          <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </label>
        <label className="f">
          Телефон
          <input inputMode="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </label>
        <label className="f">
          Логін *
          <input
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={v.login}
            placeholder="латиницею, напр. ivan"
            onChange={(e) => setV({ ...v, login: e.target.value })}
          />
        </label>
        <label className="f">
          {user ? 'Новий пароль' : 'Пароль *'}
          <input
            type="text"
            autoComplete="new-password"
            value={v.password}
            placeholder={user ? 'порожньо — не змінювати' : `щонайменше ${PASSWORD_MIN} символів`}
            onChange={(e) => setV({ ...v, password: e.target.value })}
          />
        </label>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <legend className="f" style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
          Ролі * (можна кілька)
        </legend>
        {ROLES.map((r) => (
          <label className="chk" key={r}>
            <input type="checkbox" checked={v.roles.includes(r)} onChange={(e) => setRole(r, e.target.checked)} />
            <b style={{ fontWeight: 500 }}>{r}</b> <span className="muted">— {ROLE_HINTS[r]}</span>
          </label>
        ))}
      </fieldset>
      <WarnBox>{err}</WarnBox>
      <div className="act">
        {user && user.id !== me.id && (
          <span style={{ marginRight: 'auto' }}>
            {user.disabled ? (
              <button type="button" className="btn" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
                Увімкнути доступ
              </button>
            ) : (
              <ConfirmButton disabled={toggle.isPending} onConfirm={() => toggle.mutate()}>
                Вимкнути доступ
              </ConfirmButton>
            )}
          </span>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Скасувати
        </button>
        <button type="submit" className="btn pri" disabled={save.isPending}>
          {user ? 'Зберегти' : 'Створити'}
        </button>
      </div>
    </Modal>
  );
}
