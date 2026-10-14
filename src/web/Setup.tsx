import { useState } from 'react'
import logoUrl from '../renderer/public/muse-logo.png'
import { GatewayClient } from './gateway-client'
import './styles.css'

const client = new GatewayClient()

export function Setup() {
  const [passcode, setPasscode] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [complete, setComplete] = useState(false)
  const token = new URLSearchParams(window.location.search).get('token') ?? ''

  const submit = async () => {
    setMessage('')
    if (!token) {
      setMessage('This setup link is missing its one-time token.')
      return
    }
    if (passcode.length < 12) {
      setMessage('Use at least 12 characters for your passcode.')
      return
    }
    if (passcode !== confirmation) {
      setMessage('The passcodes do not match.')
      return
    }
    try {
      await client.setupPasscode(token, passcode)
      setComplete(true)
      setPasscode('')
      setConfirmation('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Passcode setup failed.')
    }
  }

  return (
    <main className="web-page">
      <section className="web-card web-login" aria-labelledby="setup-title">
        <img src={logoUrl} alt="Mused" className="web-logo" />
        <p className="web-eyebrow">PRIVATE HOSTED ACCESS</p>
        <h1 id="setup-title">Create your Mused passcode</h1>
        {complete ? (
          <>
            <p className="web-muted">
              Your passcode is set. Return to the Mused sign-in page and use it to connect.
            </p>
            <a className="web-button primary" href="/">
              Continue to Mused
            </a>
          </>
        ) : (
          <>
            <p className="web-muted">
              Choose a passcode for this private workspace. The setup link works once and expires
              automatically.
            </p>
            <label className="web-label" htmlFor="new-passcode">
              New passcode
            </label>
            <input
              id="new-passcode"
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              autoComplete="new-password"
            />
            <label className="web-label" htmlFor="confirm-passcode">
              Confirm passcode
            </label>
            <input
              id="confirm-passcode"
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit()
              }}
              autoComplete="new-password"
            />
            <button
              className="web-button primary"
              onClick={() => void submit()}
              disabled={!passcode || !confirmation}
            >
              Save passcode
            </button>
            {message && (
              <p className="web-error" role="alert">
                {message}
              </p>
            )}
          </>
        )}
      </section>
    </main>
  )
}
