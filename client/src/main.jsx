import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.jsx'
import { installSessionGuard } from './sessionGuard.js'

// US-28 SEC-8: 30-minute inactivity timeout and "session ended" handling.
installSessionGuard()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
