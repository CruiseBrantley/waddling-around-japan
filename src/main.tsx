import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initApiUrl } from './utils/api'

// Resolve the live API URL before mounting the app.
// In local dev this resolves instantly; in production it fetches /api-config.json.
initApiUrl().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
