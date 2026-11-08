
import { Suspense, lazy, useEffect, useState } from 'react';
import App from './App.jsx';
import AppLockGate from './AppLockGate.jsx';

const loaders = {
  accounts: () => import('./AccountsPage.jsx'),
  budgets: () => import('./BudgetsPage.jsx'),
  transactions: () => import('./TransactionsPage.jsx'),
  categories: () => import('./CategoriesPage.jsx'),
  totals: () => import('./TotalsPage.jsx'),
  dashboard: () => import('./DashboardPage.jsx'),
  data: () => import('./ImportExportPage.jsx'),
  charts: () => import('./ChartsPage.jsx'),
  reports: () => import('./ReportsPage.jsx'),
  security: () => import('./SecurityPage.jsx'),
  recurring: () => import('./RecurringPage.jsx'),
  bills: () => import('./BillRemindersPage.jsx'),
  goals: () => import('./SavingsGoalsPage.jsx'),
  admin: () => import('./AdminPage.jsx'),
  privacy: () => import('./PrivacyPage.jsx'),
  recovery: () => import('./RecoveryPage.jsx'),
};

const AccountsPage = lazy(loaders.accounts);
const BudgetsPage = lazy(loaders.budgets);
const TransactionsPage = lazy(loaders.transactions);
const CategoriesPage = lazy(loaders.categories);
const TotalsPage = lazy(loaders.totals);
const DashboardPage = lazy(loaders.dashboard);
const ImportExportPage = lazy(loaders.data);
const ChartsPage = lazy(loaders.charts);
const ReportsPage = lazy(loaders.reports);
const SecurityPage = lazy(loaders.security);
const RecurringPage = lazy(loaders.recurring);
const BillRemindersPage = lazy(loaders.bills);
const SavingsGoalsPage = lazy(loaders.goals);
const AdminPage = lazy(loaders.admin);
const PrivacyPage = lazy(loaders.privacy);
const RecoveryPage = lazy(loaders.recovery);

function prefetchPages() {
  const run = () => Object.values(loaders).forEach((load) => load().catch(() => {}));

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 3000 });
  } else {
    window.setTimeout(run, 1500);
  }
}

function Loading() {
  return (
    <p role="status" style={{ padding: 24, color: '#94a3b8', fontFamily: 'system-ui' }}>
      Loading…
    </p>
  );
}

function FinancialDisclaimer() {
  return (
    <footer
      role="contentinfo"
      style={{
        padding: '14px 20px',
        textAlign: 'center',
        color: '#94a3b8',
        fontSize: 12,
        lineHeight: 1.6,
        borderTop: '1px solid rgba(148, 163, 184, 0.2)',
        background: '#0f172a',
      }}
    >
      PFEM is a personal finance tracking tool, not a financial adviser.
      {' '}<a href="#/recovery" style={{ color: '#86efac' }}>Recover deleted items</a>.{' '}
      Information and calculations are for informational purposes only
      and should not be considered financial, investment, or tax advice.
    </footer>
  );
}

export default function Root() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onChange = () => setHash(window.location.hash);

    window.addEventListener('hashchange', onChange);

    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  useEffect(prefetchPages, []);

  return (
    <AppLockGate>
      <Suspense fallback={<Loading />}>
        <Page hash={hash} />
      </Suspense>
      <FinancialDisclaimer />
    </AppLockGate>
  );
}

function Page({ hash }) {
  if (hash === '#/accounts') return <AccountsPage />;
  if (hash === '#/budgets') return <BudgetsPage />;
  if (hash === '#/recurring') return <RecurringPage />;
  if (hash === '#/bills') return <BillRemindersPage />;
  if (hash === '#/transactions') return <TransactionsPage />;
  if (hash === '#/categories') return <CategoriesPage />;
  if (hash === '#/totals') return <TotalsPage />;
  if (hash === '#/dashboard') return <DashboardPage />;
  if (hash === '#/data') return <ImportExportPage />;
  if (hash === '#/charts') return <ChartsPage />;
  if (hash === '#/reports') return <ReportsPage />;
  if (hash === '#/security') return <SecurityPage />;
  if (hash === '#/goals') return <SavingsGoalsPage />;
  if (hash === '#/admin') return <AdminPage />;
  if (hash === '#/privacy') return <PrivacyPage />;
  if (hash === '#/recovery') return <RecoveryPage />;

  return <App />;
}
