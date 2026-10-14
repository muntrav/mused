import { useEffect, useState } from 'react'
import { App as DesktopApp } from '../renderer/src/App'
import { GatewayClient } from './gateway-client'
import { createWebDesktopAPI } from './desktop-api'

const accessClient = new GatewayClient()

function HostedAccess({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [passcode, setPasscode] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void accessClient
      .session()
      .then((authenticated) => {
        if (authenticated) onAuthenticated()
        else setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [onAuthenticated])

  const login = async () => {
    setError('')
    try {
      await accessClient.login(passcode)
      setPasscode('')
      onAuthenticated()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Login failed.')
    }
  }

  if (loading) return <main className="web-loading">Loading Mused…</main>
  return (
    <main className="web-page">
      <section className="web-card web-login" aria-labelledby="login-title">
        <img src="/muse-logo.png" alt="Mused" className="web-logo" />
        <p className="web-eyebrow">PRIVATE HOSTED ACCESS</p>
        <h1 id="login-title">Welcome to Mused</h1>
        <p className="web-muted">Connect to your protected Mused workspace.</p>
        <label className="web-label" htmlFor="passcode">
          Access code
        </label>
        <input
          id="passcode"
          type="password"
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void login()
          }}
          autoComplete="current-password"
        />
        <button className="web-button primary" onClick={() => void login()} disabled={!passcode}>
          Continue
        </button>
        {error && (
          <p className="web-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  )
}

const webApi = createWebDesktopAPI()
window.muse = webApi

export function App() {
  const [authenticated, setAuthenticated] = useState(false)
  if (!authenticated) return <HostedAccess onAuthenticated={() => setAuthenticated(true)} />
  return <DesktopApp />
}
