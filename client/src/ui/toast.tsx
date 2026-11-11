import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Toast = { msg: string; err: boolean; id: number };
const Ctx = createContext<(msg: string, err?: boolean) => void>(() => {});

/** Коротке повідомлення внизу екрана (замість alert). Помилки — червоні. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((msg: string, err = false) => {
    window.clearTimeout(timer.current);
    setT({ msg, err, id: Date.now() });
    timer.current = window.setTimeout(() => setT(null), err ? 5000 : 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {t && (
        <div key={t.id} className={`toast ${t.err ? 'err' : ''}`} role={t.err ? 'alert' : 'status'}>
          {t.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
