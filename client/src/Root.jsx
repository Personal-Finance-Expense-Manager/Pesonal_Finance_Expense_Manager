
import { Suspense, lazy, useEffect, useState } from 'react';
import App from './App.jsx';

// US-27 (PER-2): each feature page is its own file. The home/sign-in screen
// loads without the code of every other page, and the pages are fetched in
// the background once the browser is idle, so moving between screens does
// not wait for a download. New pages (charts especially) stay off the first
// screen the same way: add a loader here and a line in Page below.
const loaders = {
  accounts: () => import('./AccountsPage.jsx'),
  budgets: () => import('./BudgetsPage.jsx'),
  transactions: () => import('./TransactionsPage.jsx'),
  categories: () => import('./CategoriesPage.jsx'),
  totals: () => import('./TotalsPage.jsx'),
  dashboard: () => import('./DashboardPage.jsx'),
  data: () => import('./ImportExportPage.jsx'),
};

const AccountsPage = lazy(loaders.accounts);
const BudgetsPage = lazy(loaders.budgets);
const TransactionsPage = lazy(loaders.transactions);
const CategoriesPage = lazy(loaders.categories);
const TotalsPage = lazy(loaders.totals);
const DashboardPage = lazy(loaders.dashboard);
const ImportExportPage = lazy(loaders.data);

function prefetchPages() {
  const run = () => Object.values(loaders).forEach((load) => load().catch(() => {}));
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 3000 });
  else window.setTimeout(run, 1500);
}

function Loading() {
  return (
    <p role="status" style={{ padding: 24, color: '#94a3b8', fontFamily: 'system-ui' }}>
      Loading…
    </p>
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
    <Suspense fallback={<Loading />}>
      <Page hash={hash} />
    </Suspense>
  );
}

function Page({ hash }) {
  if (hash === '#/accounts') return <AccountsPage />;
  if (hash === '#/budgets') return <BudgetsPage />;
  if (hash === '#/transactions') return <TransactionsPage />;
  if (hash === '#/categories') return <CategoriesPage />;
  if (hash === '#/totals') return <TotalsPage />;
  if (hash === '#/dashboard') return <DashboardPage />;
  if (hash === '#/data') return <ImportExportPage />;

  return <App />;
}
