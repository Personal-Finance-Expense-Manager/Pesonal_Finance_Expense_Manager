import { useEffect, useState } from 'react'
import App from './App.jsx'
import AccountsPage from './AccountsPage.jsx'

// Minimal hash routing until the app gets a real router:
//   #/          registration / sign-in (App.jsx)
//   #/accounts  accounts and wallets (US-06)
export default function Root() {
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  if (hash === '#/accounts') return <AccountsPage />
  return <App />
}
