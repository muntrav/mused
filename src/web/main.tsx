import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Setup } from './Setup'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{window.location.pathname === '/setup' ? <Setup /> : <App />}</StrictMode>,
)
