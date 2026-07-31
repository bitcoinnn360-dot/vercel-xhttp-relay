import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
/* Plain CSS after Tailwind — stays unlayered / overrides shell if needed */
import './critical.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
