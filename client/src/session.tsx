import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setUnauthorizedHandler } from './api';
import type { SessionInfo } from './types';

interface SessionCtx {
  session: SessionInfo | null;
  loading: boolean;
  setSession: (s: SessionInfo | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);
const KEY = ['session'];

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      try {
        return await api.get<SessionInfo>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2,
  });

  const setSession = useCallback(
    (s: SessionInfo | null) => {
      if (!s) qc.clear();
      qc.setQueryData(KEY, s);
    },
    [qc],
  );

  useEffect(() => {
    // Сесія завершилась під час роботи (вимкнули доступ, змінили пароль) — на екран входу.
    setUnauthorizedHandler(() => {
      if (qc.getQueryData(KEY)) setSession(null);
    });
  }, [qc, setSession]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setSession(null);
    }
  }, [setSession]);

  const theme = q.data?.user.theme ?? null;
  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }, [theme]);

  const value = useMemo(
    () => ({ session: q.data ?? null, loading: q.isPending, setSession, logout }),
    [q.data, q.isPending, setSession, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession поза SessionProvider');
  return c;
}

/** Поточна сесія — у захищених сторінках вона завжди є. */
export function useMe(): SessionInfo {
  const { session } = useSession();
  if (!session) throw new Error('Немає сесії');
  return session;
}
