import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { initials } from '@vudo/shared';
import { api } from './api';
import { useMe, useSession } from './session';
import { NavIcon } from './ui/NavIcon';
import { useDrawer } from './orders/hooks';
import { OrderDrawer } from './orders/OrderDrawer';
import { ClientDrawer } from './pages/Clients';
import { isOffice } from '@vudo/shared';

/** Ліва бічна панель (на екрані до 760 px — верхній рядок з кнопкою «Меню») і робоча область. */
export function Layout({ children }: { children: ReactNode }) {
  const { user, nav } = useMe();
  const { logout } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  // Вибір розділу закриває меню на телефоні.
  useEffect(() => setOpen(false), [loc.pathname]);

  const unread = useQuery({
    queryKey: ['log', 'unread'],
    queryFn: () => api.get<{ total: number }>('/log/unread'),
    refetchInterval: 60_000,
  });

  return (
    <div className="app">
      <aside className={`sidenav ${open ? 'open' : ''}`}>
        <div className="sn-top">
          <div className="brand">
            <i />
            VUDO <small>ERP</small>
          </div>
          <button type="button" className="btn sm menu-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Закрити' : 'Меню'}
          </button>
        </div>
        <nav className="tabs" aria-label="Розділи">
          {nav.map((n) => (
            <NavLink key={n.key} to={`/${n.key}`}>
              <NavIcon section={n.key} />
              <span className="lbl">{n.label}</span>
              {n.key === 'notes' && !!unread.data?.total && <span className="badge">{unread.data.total}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="me">
          <div className="who">
            <span className="av">{initials(user.name)}</span>
            <div>
              <b>{user.name}</b>
              <span>{user.roles.join(', ')}</span>
            </div>
          </div>
          <button type="button" className="btn sm" onClick={() => void logout()}>
            Вийти
          </button>
        </div>
      </aside>
      <main>{children}</main>
      <Drawers />
    </div>
  );
}

/** Картки замовлення і клієнта відкриваються з будь-якого розділу (?order=ID / ?client=ID). */
function Drawers() {
  const { orderId, clientId } = useDrawer();
  const { user } = useMe();
  if (orderId) return <OrderDrawer key={orderId} id={orderId} />;
  if (clientId && isOffice(user)) return <ClientDrawer key={clientId} id={clientId} />;
  return null;
}
