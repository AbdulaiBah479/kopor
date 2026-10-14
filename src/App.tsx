import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './state/app';
import { OverlayProvider } from './ui/overlay';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Welcome } from './screens/Welcome';
import { Lock } from './screens/Lock';
import { Home } from './screens/Home';
import { CreditList, ContactDetail } from './screens/Credit';
import { CashBook } from './screens/Cash';
import { StockList } from './screens/Stock';
import { More } from './screens/More';

// Less-used screens load on demand to keep the first load small on slow networks.
const Groups = lazy(() => import('./screens/Groups').then((m) => ({ default: m.GroupList })));
const GroupDetail = lazy(() => import('./screens/Groups').then((m) => ({ default: m.GroupDetail })));
const Invoices = lazy(() => import('./screens/Invoices').then((m) => ({ default: m.InvoiceList })));
const InvoiceDetail = lazy(() => import('./screens/Invoices').then((m) => ({ default: m.InvoiceDetail })));
const Payments = lazy(() => import('./screens/Payments').then((m) => ({ default: m.Payments })));
const Reminders = lazy(() => import('./screens/Reminders').then((m) => ({ default: m.Reminders })));
const Assistant = lazy(() => import('./screens/Assistant').then((m) => ({ default: m.Assistant })));
const Health = lazy(() => import('./screens/Health').then((m) => ({ default: m.Health })));
const Report = lazy(() => import('./screens/Health').then((m) => ({ default: m.Report })));
const Team = lazy(() => import('./screens/Team').then((m) => ({ default: m.Team })));
const Audit = lazy(() => import('./screens/Team').then((m) => ({ default: m.Audit })));
const Settings = lazy(() => import('./screens/Settings').then((m) => ({ default: m.Settings })));
const Account = lazy(() => import('./screens/Settings').then((m) => ({ default: m.Account })));
const PublicInvoice = lazy(() => import('./screens/PublicInvoice').then((m) => ({ default: m.PublicInvoice })));
const Help = lazy(() => import('./screens/Help').then((m) => ({ default: m.Help })));
const Legal = lazy(() => import('./screens/Legal').then((m) => ({ default: m.Legal })));
const Plan = lazy(() => import('./screens/Plan').then((m) => ({ default: m.Plan })));

const Boot = () => <div className="boot"><div className="boot-logo">K</div></div>;

function Gate() {
  const { ready, session, book, locked } = useApp();
  const { pathname } = useLocation();
  // Public pages work without a business or sign-in (customer invoice links, legal pages for app stores).
  if (pathname.startsWith('/i/') || pathname.startsWith('/legal/')) return (
    <Suspense fallback={<Boot />}><Routes>
      <Route path="/i/:token" element={<PublicInvoice />} />
      <Route path="/legal/:doc" element={<Legal />} />
    </Routes></Suspense>
  );
  if (!ready || (session && book === undefined)) return <Boot />;
  if (!session || !book) return <Welcome />;
  if (locked) return <Lock />;
  return (
    <Suspense fallback={<Boot />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/credit" element={<CreditList />} />
        <Route path="/credit/:id" element={<ContactDetail />} />
        <Route path="/cash" element={<CashBook />} />
        <Route path="/stock" element={<StockList />} />
        <Route path="/more" element={<More />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/groups/:id" element={<GroupDetail />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/reminders" element={<Reminders />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/health" element={<Health />} />
        <Route path="/report" element={<Report />} />
        <Route path="/team" element={<Team />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/account" element={<Account />} />
        <Route path="/help" element={<Help />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <OverlayProvider>
          <Gate />
        </OverlayProvider>
      </AppProvider>
    </ErrorBoundary>
  );
}
