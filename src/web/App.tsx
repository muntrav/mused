import { useEffect, useMemo, useState } from 'react'
import logoUrl from '../renderer/public/muse-logo.png'
import type { GatewayEvent } from '../gateway/protocol'
import type { ChangeTask } from '../shared/change-task'
import { GatewayClient } from './gateway-client'
import './styles.css'

const client = new GatewayClient()

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [provider, setProvider] = useState('')
  const [prompt, setPrompt] = useState('')
  const [reply, setReply] = useState('')
  const [page, setPage] = useState<'conversation' | 'tasks'>('conversation')
  const [tasks, setTasks] = useState<ChangeTask[]>([])
  const [repositoryRoot, setRepositoryRoot] = useState('')
  const [taskPrompt, setTaskPrompt] = useState('')

  useEffect(() => {
    void client
      .session()
      .then(setAuthenticated)
      .catch(() => setAuthenticated(false))
    return () => client.close()
  }, [])

  useEffect(() => {
    if (!authenticated) return
    let active = true
    const unsubscribe = client.subscribe((event: GatewayEvent) => {
      if (event.type !== 'task') return
      setTasks((current) => [event.task, ...current.filter((task) => task.id !== event.task.id)])
    })
    void client
      .connect()
      .then(async () => {
        if (!active) return
        setConnected(true)
        const status = await client.request<{ provider: string }>({
          type: 'agent',
          action: 'status',
        })
        if (active) setProvider(status.provider)
        const currentTasks = await client.request<ChangeTask[]>({ type: 'task', action: 'list' })
        if (active) setTasks(currentTasks)
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
    return () => {
      active = false
      unsubscribe()
      client.close()
    }
  }, [authenticated])

  const statusLabel = useMemo(() => {
    if (!authenticated) return 'Sign in to continue'
    if (!connected) return 'Connecting to Mused'
    return `Connected to ${provider || 'agent runtime'}`
  }, [authenticated, connected, provider])

  const login = async () => {
    setError('')
    try {
      await client.login(passcode)
      setAuthenticated(true)
      setPasscode('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const send = async () => {
    if (!prompt.trim()) return
    setError('')
    try {
      const threads = await client.request<{
        items: Array<{ id: string }>
        nextCursor: string | null
      }>({
        type: 'agent',
        action: 'list-threads',
      })
      let threadId = threads.items[0]?.id
      if (!threadId) {
        const thread = await client.request<{ thread: { id: string } }>({
          type: 'agent',
          action: 'start-thread',
          input: { workspaceRoot: '/' },
        })
        threadId = thread.thread.id
      }
      await client.request({
        type: 'agent',
        action: 'start-turn',
        input: { threadId, text: prompt, effort: 'high', mode: 'queue' },
      })
      setReply('The request was accepted by the Mused agent boundary.')
      setPrompt('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const createTask = async () => {
    if (!repositoryRoot.trim() || !taskPrompt.trim()) {
      setError('Enter a repository path and describe the change first.')
      return
    }
    setError('')
    try {
      const task = await client.request<ChangeTask>({
        type: 'task',
        action: 'create',
        input: { repositoryRoot, prompt: taskPrompt, risk: 'renderer-behavior' },
      })
      setTasks((current) => [task, ...current.filter((entry) => entry.id !== task.id)])
      setTaskPrompt('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  if (authenticated === null) return <main className="web-loading">Loading Mused…</main>
  if (!authenticated)
    return (
      <main className="web-page">
        <section className="web-card web-login" aria-labelledby="login-title">
          <img src={logoUrl} alt="Mused" className="web-logo" />
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
            onKeyDown={(event) => event.key === 'Enter' && void login()}
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

  return (
    <main className="web-app">
      <aside className="web-sidebar">
        <div className="web-brand">
          <img src={logoUrl} alt="" />
          <span>Mused</span>
        </div>
        <p className="web-eyebrow">WORKSPACE</p>
        <button
          className={`web-nav ${page === 'conversation' ? 'active' : ''}`}
          onClick={() => setPage('conversation')}
        >
          Conversation
        </button>
        <button className="web-nav">Projects</button>
        <button
          className={`web-nav ${page === 'tasks' ? 'active' : ''}`}
          onClick={() => setPage('tasks')}
        >
          Change tasks
        </button>
        <div className="web-sidebar-spacer" />
        <p className="web-status">
          <span className={connected ? 'status-dot ready' : 'status-dot'} />
          {statusLabel}
        </p>
      </aside>
      <section className="web-conversation">
        {page === 'conversation' ? (
          <>
            <header className="web-header">
              <div>
                <p className="web-eyebrow">MUSED HOSTED INTERFACE</p>
                <h1>Conversation</h1>
              </div>
              <span className="web-pill">{provider || 'agent'}</span>
            </header>
            <div className="web-transcript">
              <div className="web-welcome">
                <img src={logoUrl} alt="" />
                <h2>What would you like to build?</h2>
                <p>
                  Use the hosted Mused runtime to explore a workspace or start a controlled change
                  task.
                </p>
              </div>
              {reply && <div className="web-message agent">{reply}</div>}
            </div>
            <div className="web-composer">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask Mused to explore or plan a change…"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <button
                className="web-button primary"
                onClick={() => void send()}
                disabled={!prompt.trim() || !connected}
              >
                Send
              </button>
            </div>
          </>
        ) : (
          <>
            <header className="web-header">
              <div>
                <p className="web-eyebrow">SELF-DEVELOPING ENVIRONMENT</p>
                <h1>Change tasks</h1>
              </div>
              <span className="web-pill">isolated worktrees</span>
            </header>
            <div className="web-task-page">
              <section className="web-card web-task-form">
                <h2>Request a controlled change</h2>
                <p className="web-muted">
                  Mused will create an isolated worktree. Nothing is applied to the running project
                  until approval.
                </p>
                <label className="web-label" htmlFor="repository-root">
                  Repository path
                </label>
                <input
                  id="repository-root"
                  value={repositoryRoot}
                  onChange={(event) => setRepositoryRoot(event.target.value)}
                  placeholder="/srv/projects/mused"
                />
                <label className="web-label" htmlFor="task-prompt">
                  What should change?
                </label>
                <textarea
                  id="task-prompt"
                  value={taskPrompt}
                  onChange={(event) => setTaskPrompt(event.target.value)}
                  placeholder="Change how this button works…"
                />
                <button
                  className="web-button primary"
                  onClick={() => void createTask()}
                  disabled={!connected}
                >
                  Create isolated task
                </button>
              </section>
              <section className="web-task-list">
                <p className="web-eyebrow">RECENT TASKS</p>
                {tasks.length === 0 ? (
                  <p className="web-muted">No change tasks yet.</p>
                ) : (
                  tasks.map((task) => (
                    <article className="web-task-card" key={task.id}>
                      <div className="web-task-card-header">
                        <strong>{task.prompt}</strong>
                        <span className="web-pill">{task.state}</span>
                      </div>
                      <p className="web-muted">{task.repositoryRoot}</p>
                      {task.worktreePath && <p className="web-task-path">{task.worktreePath}</p>}
                      {task.error && <p className="web-error">{task.error}</p>}
                    </article>
                  ))
                )}
              </section>
            </div>
          </>
        )}
        {error && (
          <p className="web-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  )
}
