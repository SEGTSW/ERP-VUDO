import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MSG, PASSWORD_MIN, STATUSES, isOwner, type Settings as SettingsT } from '@vudo/shared';
import { api, errorText } from '../api';
import { useMe, useSession } from '../session';
import type { SessionInfo, SettingsView } from '../types';
import { NumberField, Select, TextField, WarnBox } from '../ui/common';
import { useToast } from '../ui/toast';
import { UsersSection } from './Users';

/** Налаштування (ТЗ розділ 13): профіль, ціни, норми, користувачі. Бачать Адмін і Менеджер. */
export function Settings() {
  const { user } = useMe();
  const owner = isOwner(user);
  return (
    <>
      <div className="bar">
        <h1 className="grow">Налаштування</h1>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 820 }}>
        <ProfileSection />
        <SettingsSections owner={owner} />
        <UsersSection />
      </div>
    </>
  );
}

function useSaveProfile() {
  const { setSession } = useSession();
  const toast = useToast();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<SessionInfo>('/profile', patch),
    onSuccess: (s) => {
      setSession(s);
      toast('Збережено');
    },
    onError: (e) => toast(errorText(e), true),
  });
}

export function ProfileSection() {
  const { user, nav } = useMe();
  const save = useSaveProfile();
  const starts = nav.filter((n) => n.key !== 'settings').map((n) => [n.key, n.label] as const);
  const defaultStart = starts[0]?.[0] ?? 'orders';
  return (
    <div className="sec">
      <h2>Мій профіль</h2>
      <div className="grid">
        <label className="f">
          Ім'я
          <input value={user.name} disabled />
        </label>
        <label className="f">
          Логін
          <input value={user.login} disabled />
        </label>
        <label className="f">
          Ролі
          <input value={user.roles.join(', ')} disabled />
        </label>
        <label className="f">
          Мій телефон
          <TextField value={user.phone ?? ''} inputMode="tel" placeholder="+380 __ ___ __ __" onCommit={(phone) => save.mutate({ phone })} />
        </label>
      </div>
      <div className="grid">
        <label className="f">
          Тема оформлення
          <Select
            value={user.theme ?? ''}
            options={[
              ['', 'Як у системі'],
              ['light', 'Світла'],
              ['dark', 'Темна'],
            ]}
            onChange={(v) => save.mutate({ theme: v || null })}
          />
        </label>
        <label className="f">
          Розділ після входу
          <Select
            value={starts.some((s) => s[0] === user.startSection) ? (user.startSection as string) : defaultStart}
            options={starts}
            onChange={(v) => save.mutate({ startSection: v })}
          />
        </label>
        <label className="f">
          Рядків у списку замовлень
          <Select
            value={String(user.ordersRows ?? '')}
            options={[
              ['', 'усі'],
              ['25', '25'],
              ['50', '50'],
              ['100', '100'],
            ]}
            onChange={(v) => save.mutate({ ordersRows: v ? Number(v) : null })}
          />
        </label>
      </div>
      <PasswordForm />
    </div>
  );
}

function PasswordForm() {
  const toast = useToast();
  const [v, setV] = useState({ current: '', next: '', repeat: '' });
  const [err, setErr] = useState('');
  const m = useMutation({
    mutationFn: () => api.post('/profile/password', { current: v.current, next: v.next }),
    onSuccess: () => {
      setV({ current: '', next: '', repeat: '' });
      setErr('');
      toast('Пароль змінено');
    },
    onError: (e) => setErr(errorText(e)),
  });
  return (
    <form
      style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (v.next.length < PASSWORD_MIN) return setErr(`Новий пароль: щонайменше ${PASSWORD_MIN} символів.`);
        if (v.next !== v.repeat) return setErr(MSG.pwMismatch);
        if (v.next === v.current) return setErr(MSG.pwSame);
        m.mutate();
      }}
    >
      <b style={{ fontWeight: 600, fontSize: 13 }}>Змінити пароль</b>
      <input type="text" name="username" autoComplete="username" hidden readOnly />
      <div className="grid">
        <label className="f">
          Поточний пароль
          <input type="password" autoComplete="current-password" value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} />
        </label>
        <label className="f">
          Новий пароль
          <input type="password" autoComplete="new-password" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} />
        </label>
        <label className="f">
          Ще раз
          <input type="password" autoComplete="new-password" value={v.repeat} onChange={(e) => setV({ ...v, repeat: e.target.value })} />
        </label>
      </div>
      <WarnBox>{err}</WarnBox>
      <div>
        <button className="btn sm pri" type="submit" disabled={m.isPending}>
          Змінити пароль
        </button>
      </div>
    </form>
  );
}

function SettingsSections({ owner }: { owner: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsView>('/settings') });
  const save = useMutation({
    mutationFn: (patch: Partial<SettingsT>) => api.patch<SettingsView>('/settings', patch),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      toast('Збережено');
    },
    onError: (e) => {
      toast(errorText(e), true);
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  if (q.isPending) return <div className="sec">Завантаження…</div>;
  if (q.isError) return <div className="sec warnbox">Не вдалося завантажити налаштування. Оновіть сторінку.</div>;
  const s = q.data;

  const pct = (key: 'avansPct' | 'markupPct' | 'designerPct' | 'opexPct', max = 100) => (
    <NumberField
      value={s[key]}
      min={0}
      max={max}
      onCommit={(v) => {
        if (v == null || v < 0 || v > max) return toast(`Вкажіть число від 0 до ${max}.`, true);
        save.mutate({ [key]: v });
      }}
    />
  );

  return (
    <>
      <div className="sec">
        <h2>Ціни та оплати</h2>
        <div className="grid">
          <label className="f">
            Мінімальний аванс для договору, %{pct('avansPct')}
          </label>
          {owner && (
            <label className="f">
              Постійні витрати на замовлення, % від ціни{pct('opexPct')}
            </label>
          )}
        </div>
        <div className="grid">
          <label className="f">
            Наша націнка (робота і монтаж), %{pct('markupPct', 500)}
          </label>
          <label className="f">
            Бонус дизайнерам за замовчуванням, %{pct('designerPct')}
          </label>
        </div>
        {owner && (
          <div className="grid">
            <label className="f">
              Режим постійних витрат на замовлення
              <Select
                value={s.opexMode ?? 'auto'}
                options={[
                  ['auto', 'Авто зі списку постійних витрат'],
                  ['fixed', 'Вручну: % від ціни'],
                ]}
                onChange={(v) => save.mutate({ opexMode: v })}
              />
            </label>
            <label className="f">
              Ставка менеджерів, % від продажів
              <NumberField
                value={s.mgrPct ?? null}
                placeholder="не задана"
                onCommit={(v) => {
                  if (v != null && (v < 0 || v > 100)) return toast('Вкажіть число від 0 до 100.', true);
                  save.mutate({ mgrPct: v });
                }}
              />
            </label>
          </div>
        )}
      </div>

      <div className="sec">
        <h2>Нормативний час у статусі, днів</h2>
        <div className="grid">
          {STATUSES.map((st) => (
            <label className="f" key={st}>
              {st}
              <NumberField
                value={s.norms[st] ?? null}
                placeholder="без норми"
                onCommit={(v) => {
                  if (v != null && (!Number.isInteger(v) || v < 1 || v > 365)) return toast('Норма — ціле число днів від 1 до 365.', true);
                  const norms = { ...s.norms };
                  if (v == null) delete norms[st];
                  else norms[st] = v;
                  save.mutate({ norms });
                }}
              />
            </label>
          ))}
        </div>
        <div className="note">Якщо замовлення в статусі довше норми, воно позначається червоним і потрапляє у фільтр «Прострочені».</div>
      </div>
    </>
  );
}
