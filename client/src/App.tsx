import { Navigate, Route, Routes, useParams } from 'react-router';
import { canSee, type Section } from '@vudo/shared';
import { Layout } from './Layout';
import { useMe, useSession } from './session';
import { Login } from './pages/Login';
import { Notes } from './pages/Notes';
import { Settings } from './pages/Settings';
import { Stub } from './pages/Stub';
import { Orders } from './pages/Orders';
import { Crm } from './pages/Crm';
import { Clients } from './pages/Clients';
import { Plan } from './pages/Plan';
import { MyDay } from './pages/MyDay';
import { Stock } from './pages/Stock';
import { Finance } from './pages/Finance';
import { Stats } from './pages/Stats';

const PAGES: Partial<Record<Section, () => React.JSX.Element>> = {
  orders: Orders,
  crm: Crm,
  clients: Clients,
  plan: Plan,
  myday: MyDay,
  stock: Stock,
  finance: Finance,
  stats: Stats,
  notes: Notes,
  settings: Settings,
};

/** Розділ за адресою; недоступний ролі — перехід на стартовий (сервер усе одно не віддасть дані). */
function SectionPage() {
  const { section } = useParams();
  const { user, start } = useMe();
  if (!section || !canSee(user, section as Section)) return <Navigate to={`/${start}`} replace />;
  const Page = PAGES[section as Section];
  return Page ? <Page /> : <Stub section={section as Section} />;
}

export function App() {
  const { session, loading } = useSession();
  if (loading) return <div className="boot">Завантаження…</div>;
  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return (
    <Layout>
      <Routes>
        <Route path="/:section" element={<SectionPage />} />
        <Route path="*" element={<Navigate to={`/${session.start}`} replace />} />
      </Routes>
    </Layout>
  );
}
