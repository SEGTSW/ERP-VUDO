import { useEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react';

/**
 * Кнопка з підтвердженням повторним натисканням «Точно?» (замість confirm()).
 * Через 4 с без другого кліку повертається до звичайного стану.
 */
export function ConfirmButton({
  children,
  onConfirm,
  className = 'btn warn',
  confirmText = 'Точно?',
  disabled,
}: {
  children: ReactNode;
  onConfirm: () => void;
  className?: string;
  confirmText?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className}${armed ? ' confirm' : ''}`}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmText : children}
    </button>
  );
}

/** Модальне вікно: закривається Esc, кліком поза вікном або кнопкою. Фокус — на першому полі. */
export function Modal({
  children,
  onClose,
  onSubmit,
  labelledBy,
}: {
  children: ReactNode;
  onClose: () => void;
  onSubmit?: () => void;
  labelledBy?: string;
}) {
  const box = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    box.current?.querySelector<HTMLElement>('input,select,textarea')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        ref={box}
        className="mbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.();
        }}
      >
        {children}
      </form>
    </div>
  );
}

/** Червона плашка з тим, що саме зробити. */
export const WarnBox = ({ children }: { children: ReactNode }) =>
  children ? (
    <div className="warnbox" role="alert">
      {children}
    </div>
  ) : null;

export function Select<T extends string>({
  value,
  options,
  onChange,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} {...rest}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

/**
 * Числове поле, що не скидає введене під час набору (ТЗ розділ 1):
 * значення зберігається лише після виходу з поля або Enter.
 */
export function NumberField({
  value,
  onCommit,
  min,
  max,
  step,
  placeholder,
  disabled,
  id,
}: {
  value: number | null | undefined;
  onCommit: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  const ext = value == null ? '' : String(value);
  const [text, setText] = useState(ext);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(ext);
  }, [ext]);
  const commit = () => {
    const t = text.trim().replace(',', '.');
    const v = t === '' ? null : Number(t);
    if (v !== null && !Number.isFinite(v)) {
      setText(ext);
      return;
    }
    if ((v ?? '') === (value ?? '')) return;
    onCommit(v);
  };
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      aria-valuemin={min}
      aria-valuemax={max}
      data-step={step}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/** Текстове поле, що зберігається після виходу з поля. */
export function TextField({
  value,
  onCommit,
  placeholder,
  inputMode,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  inputMode?: 'tel' | 'text' | 'email';
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      value={text}
      placeholder={placeholder}
      inputMode={inputMode}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== value && onCommit(text.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}
