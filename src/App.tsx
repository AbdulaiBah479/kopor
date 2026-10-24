import { Suspense } from 'react';
import { lazyRetry } from '@/ui/lazy';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './state/app';
import { OverlayProvider } from './ui/overlay';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Welcome } from './screens/Welcome';
import { Home } from './screens/Home';
import { CreditList } from './screens/Credit';
import { CashBook } from './screens/Cash';

// Less-used screens load on demand to keep the first load small on slow networks (after the first visit they are
// stored for offline use, so they still open instantly).
const Lock = lazyRetry(() => import('./screens/Lock').then((m) => ({ default: m.Lock })));
const ContactDetail = lazyRetry(() => import('./screens/Credit').then((m) => ({ default: m.ContactDetail })));
const StockList = lazyRetry(() => import('./screens/Stock').then((m) => ({ default: m.StockList })));
const More = lazyRetry(() => import('./screens/More').then((m) => ({ default: m.More })));
const Groups = lazyRetry(() => import('./screens/Groups').then((m) => ({ default: m.GroupList })));
const GroupDetail = lazyRetry(() => import('./screens/Groups').then((m) => ({ default: m.GroupDetail })));
const Invoices = lazyRetry(() => import('./screens/Invoices').then((m) => ({ default: m.InvoiceList })));
const InvoiceDetail = lazyRetry(() => import('./screens/Invoices').then((m) => ({ default: m.InvoiceDetail })));
const Payments = lazyRetry(() => import('./screens/Payments').then((m) => ({ default: m.Payments })));
const Reminders = lazyRetry(() => import('./screens/Reminders').then((m) => ({ default: m.Reminders })));
const Assistant = lazyRetry(() => import('./screens/Assistant').then((m) => ({ default: m.Assistant })));
const Health = lazyRetry(() => import('./screens/Health').then((m) => ({ default: m.Health })));
const Report = lazyRetry(() => import('./screens/Health').then((m) => ({ default: m.Report })));
const Team = lazyRetry(() => import('./screens/Team').then((m) => ({ default: m.Team })));
const Audit = lazyRetry(() => import('./screens/Team').then((m) => ({ default: m.Audit })));
const Settings = lazyRetry(() => import('./screens/Settings').then((m) => ({ default: m.Settings })));
const Account = lazyRetry(() => import('./screens/Settings').then((m) => ({ default: m.Account })));
const PublicInvoice = lazyRetry(() => import('./screens/PublicInvoice').then((m) => ({ default: m.PublicInvoice })));
const PublicStatement = lazyRetry(() => import('./screens/PublicStatement').then((m) => ({ default: m.PublicStatement })));
const PublicGroup = lazyRetry(() => import('./screens/PublicGroup').then((m) => ({ default: m.PublicGroup })));
const Savings = lazyRetry(() => import('./screens/Savings').then((m) => ({ default: m.Savings })));
const Staff = lazyRetry(() => import('./screens/Staff').then((m) => ({ default: m.Staff })));
const Gst = lazyRetry(() => import('./screens/Gst').then((m) => ({ default: m.Gst })));
const Watch = lazyRetry(() => import('./screens/Watch').then((m) => ({ default: m.Watch })));
const Wallet = lazyRetry(() => import('./screens/Money').then((m) => ({ default: m.Wallet })));
const Help = lazyRetry(() => import('./screens/Help').then((m) => ({ default: m.Help })));
const Legal = lazyRetry(() => import('./screens/Legal').then((m) => ({ default: m.Legal })));
const Money = lazyRetry(() => import('./screens/Money').then((m) => ({ default: m.Money })));
const PayPage = lazyRetry(() => import('./screens/Money').then((m) => ({ default: m.PayRoute })));
const ProfitLoss = lazyRetry(() => import('./screens/ProfitLoss').then((m) => ({ default: m.ProfitLoss })));
const Owner = lazyRetry(() => import('./screens/Owner').then((m) => ({ default: m.Owner })));
const Plan = lazyRetry(() => import('./screens/Plan').then((m) => ({ default: m.Plan })));

const Boot = () => <div className="boot"><div className="boot-logo">K</div></div>;

function Gate() {
  const { ready, session, book, locked } = useApp();
  const { pathname } = useLocation();
  // Public pages work without a business or sign-in (customer invoice and statement links, legal pages for app stores).
  if (pathname.startsWith('/i/') || pathname.startsWith('/s/') || pathname.startsWith('/g/') || pathname.startsWith('/legal/') || pathname.startsWith('/pay/')) return (
    <Suspense fallback={<Boot />}><Routes>
      <Route path="/i/:token" element={<PublicInvoice />} />
      <Route path="/s/:token" element={<PublicStatement />} />
      <Route path="/g/:token" element={<PublicGroup />} />
      <Route path="/legal/:doc" element={<Legal />} />
      <Route path="/pay/:data" element={<PayPage />} />
    </Routes></Suspense>
  );
  if (!ready || (session && book === undefined)) return <Boot />;
  if (!session || !book) return <Welcome />;
  if (locked) return <Suspense fallback={<Boot />}><Lock /></Suspense>;
  return (
    <ErrorBoundary resetKey={pathname}>
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
        <Route path="/money" element={<Money />} />
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
        <Route path="/admin" element={<Owner />} />
        <Route path="/pnl" element={<ProfitLoss />} />
        <Route path="/savings" element={<Savings />} />
        <Route path="/staff" element={<Staff />} />
        <Route path="/gst" element={<Gst />} />
        <Route path="/watch" element={<Watch />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
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
