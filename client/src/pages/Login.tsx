import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, errorText } from '../api';
import { useSession } from '../session';
import type { SessionInfo } from '../types';
import { WarnBox } from '../ui/common';

/** Вхід за логіном і паролем. Самореєстрації немає. */
export function Login() {
  const { setSession } = useSession();
  const nav = useNavigate();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setErr('');
          try {
            const s = await api.post<SessionInfo>('/auth/login', { login, password });
            setSession(s);
            nav(`/${s.start}`, { replace: true });
          } catch (ex) {
            setErr(errorText(ex));
            setBusy(false);
          }
        }}
      >
        <div className="brand" style={{ fontSize: 18 }}>
          <i />
          VUDO <small>ERP</small>
        </div>
        <h1>Вхід</h1>
        <label className="f">
          Логін
          <input autoComplete="username" autoCapitalize="none" spellCheck={false} value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
        </label>
        <label className="f">
          Пароль
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <WarnBox>{err}</WarnBox>
        <button className="btn pri" type="submit" disabled={busy}>
          {busy ? 'Вхід…' : 'Увійти'}
        </button>
      </form>
    </div>
  );
}
