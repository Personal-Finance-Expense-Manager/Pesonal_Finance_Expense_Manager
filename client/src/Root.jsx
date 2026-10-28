
import { useEffect, useState } from 'react';
import App from './App.jsx';
import AccountsPage from './AccountsPage.jsx';
import BudgetsPage from './BudgetsPage.jsx';
import TransactionsPage from './TransactionsPage.jsx';
import CategoriesPage from './CategoriesPage.jsx';
import TotalsPage from './TotalsPage.jsx';
import DashboardPage from './DashboardPage.jsx';
import ImportExportPage from './ImportExportPage.jsx';

export default function Root() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);

    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  if (hash === '#/accounts') return <AccountsPage />;
  if (hash === '#/budgets') return <BudgetsPage />;
  if (hash === '#/transactions') return <TransactionsPage />;
  if (hash === '#/categories') return <CategoriesPage />;
  if (hash === '#/totals') return <TotalsPage />;
  if (hash === '#/dashboard') return <DashboardPage />;
  if (hash === '#/data') return <ImportExportPage />;

  return <App />;
}
