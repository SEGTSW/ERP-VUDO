import { useEffect, type ReactNode } from 'react';
import { statusGroup, type Status } from '@vudo/shared';

export const StatusPill = ({ s }: { s: Status }) => <span className={`pill g-${statusGroup(s)}`}>{s}</span>;

/** Бічна панель картки: справа (на телефоні — на весь екран), закривається ✕, кліком поза нею або Esc. */
export function Drawer({ children, onClose, label }: { children: ReactNode; onClose: () => void; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc у відкритому модальному вікні закриває лише вікно
      if (e.key === 'Escape' && !document.querySelector('.modal')) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={label}>
        {children}
      </aside>
    </>
  );
}

/** Вкладки картки. */
export function SubTabs<K extends string>({ tabs, cur, onChange }: { tabs: [K, string][]; cur: K; onChange: (k: K) => void }) {
  return (
    <div className="subtabs" role="tablist">
      {tabs.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-current={cur === k} aria-selected={cur === k} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Рядок таблиці, що відкривається кліком або Enter. */
export function RowLink({ onOpen, className, children }: { onOpen: () => void; className?: string; children: ReactNode }) {
  return (
    <tr className={className} tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      {children}
    </tr>
  );
}

export const mb = (size: number) => `${(size / 1048576).toFixed(1).replace('.', ',')} МБ`;

/** Скорочення сум для карток CRM: «борг 12,5 тис». */
export function kmoney(n: number): string {
  const a = Math.abs(n);
  if (a < 1000) return String(Math.round(n));
  return `${(n / 1000).toLocaleString('uk-UA', { maximumFractionDigits: a >= 100000 ? 0 : 1 })} тис`;
}
