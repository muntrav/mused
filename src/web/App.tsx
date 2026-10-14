import { useEffect, useMemo, useState } from 'react'
import logoUrl from '../renderer/public/muse-logo.png'
import type { AuthStatus, AgentItem, AgentThreadView } from '../shared/agent/protocol'
import type { GatewayEvent } from '../gateway/protocol'
import type { ChangeTask } from '../shared/change-task'
import { GatewayClient } from './gateway-client'
import './styles.css'

const client = new GatewayClient()

function itemText(item: AgentItem) {
  return item.displayText || item.text || item.visibleOutput || item.summary?.join('\n') || ''
}

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [provider, setProvider] = useState('')
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [thread, setThread] = useState<AgentThreadView | null>(null)
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [prompt, setPrompt] = useState('')
  const [page, setPage] = useState<'conversation' | 'tasks'>('conversation')
  const [tasks, setTasks] = useState<ChangeTask[]>([])
  const [repositoryRoot, setRepositoryRoot] = useState('')
  const [taskPrompt, setTaskPrompt] = useState('')
  const [checkCommand, setCheckCommand] = useState('npm run typecheck')

  useEffect(() => {
    void client.session().then(setAuthenticated).catch(() => setAuthenticated(false))
    return () => client.close()
  }, [])

  useEffect(() => {
    if (!authenticated) return
    let active = true
    const unsubscribe = client.subscribe((event: GatewayEvent) => {
      if (event.type === 'task') {
        setTasks((current) => [event.task, ...current.filter((task) => task.id !== event.task.id)])
        return
      }
      if (event.type !== 'event') return
      if (event.event.type === 'auth') setAuth(event.event.status)
      if (event.event.type === 'thread' && active) setThread(event.event.view)
      if (event.event.type === 'connection') setConnected(event.event.status.state === 'ready')
    })
    void client
      .connect()
      .then(async () => {
        if (!active) return
        setConnected(true)
        const status = await client.request<{
          provider: string
          auth: AuthStatus
        }>({ type: 'agent', action: 'status' })
        if (!active) return
        setProvider(status.provider)
        setAuth(status.auth)
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
    return 'Connected to ' + (provider || 'agent runtime')
  }, [authenticated, connected, provider])

  const login = async () => {
    setError('')
    try {
      const status = await client.request<AuthStatus>({
        type: 'agent',
        action: 'login',
        input: { method: 'browser' },
      })
      setAuth(status)
      if (status.loginUrl) window.open(status.loginUrl, '_blank', 'noopener,noreferrer')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const send = async () => {
    if (!prompt.trim() || !workspaceRoot.trim()) {
      setError('Choose a workspace path and write a message first.')
      return
    }
    setError('')
    try {
      let threadId = thread?.thread.id
      if (!threadId) {
        const created = await client.request<AgentThreadView>({
          type: 'agent',
          action: 'start-thread',
          input: { workspaceRoot },
        })
        threadId = created.thread.id
        setThread(created)
      }
      await client.request({
        type: 'agent',
        action: 'start-turn',
        input: { threadId, text: prompt, effort: 'high', mode: 'queue' },
      })
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

  const runTask = async (task: ChangeTask) => {
    const pieces = checkCommand.trim().split(/\s+/).filter(Boolean)
    if (!pieces.length) return
    setError('')
    try {
      await client.request({
        type: 'task',
        action: 'plan',
        input: { taskId: task.id, plan: 'Inspect the requested behavior, implement the smallest safe change, run checks, and preview the isolated worktree.' },
      })
      await client.request({
        type: 'task',
        action: 'check',
        input: {
          taskId: task.id,
          checks: [{ name: pieces.join(' '), command: pieces[0], args: pieces.slice(1), timeout: 120000 }],
          preview: { command: 'npm', args: ['run', 'web:dev'] },
        },
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const approveTask = async (task: ChangeTask) => {
    try {
      await client.request({ type: 'task', action: 'approve', input: { taskId: task.id } })
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
          <label className="web-label" htmlFor="passcode">Access code</label>
          <input id="passcode" type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void (async () => {
            try {
              await client.login(passcode)
              setAuthenticated(true)
              setPasscode('')
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : String(reason))
            }
          })()} autoComplete="current-password" />
          <button className="web-button primary" onClick={() => void (async () => {
            try {
              await client.login(passcode)
              setAuthenticated(true)
              setPasscode('')
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : String(reason))
            }
          })()} disabled={!passcode}>Continue</button>
          {error && <p className="web-error" role="alert">{error}</p>}
        </section>
      </main>
    )

  return (
    <main className="web-app">
      <aside className="web-sidebar">
        <div className="web-brand"><img src={logoUrl} alt="" /><span>Mused</span></div>
        <p className="web-eyebrow">WORKSPACE</p>
        <button className={'web-nav ' + (page === 'conversation' ? 'active' : '')} onClick={() => setPage('conversation')}>Conversation</button>
        <button className="web-nav">Projects</button>
        <button className={'web-nav ' + (page === 'tasks' ? 'active' : '')} onClick={() => setPage('tasks')}>Change tasks</button>
        <div className="web-sidebar-spacer" />
        <p className="web-status"><span className={connected ? 'status-dot ready' : 'status-dot'} />{statusLabel}</p>
      </aside>
      <section className="web-conversation">
        {page === 'conversation' ? (
          <>
            <header className="web-header">
              <div><p className="web-eyebrow">MUSED HOSTED INTERFACE</p><h1>Conversation</h1></div>
              <span className="web-pill">{provider || 'agent'}</span>
            </header>
            {auth?.state !== 'authenticated' && (
              <section className="web-card web-auth-card">
                <strong>{auth?.message || 'Codex authentication is required.'}</strong>
                <button className="web-button primary" onClick={() => void login()} disabled={auth?.state === 'logging-in'}>{auth?.state === 'logging-in' ? 'Waiting for login…' : 'Sign in with ChatGPT'}</button>
                {auth?.loginUrl && <a href={auth.loginUrl} target="_blank" rel="noreferrer">Open login page</a>}
                {auth?.deviceCode && <p className="web-muted">Device code: {auth.deviceCode}</p>}
              </section>
            )}
            <div className="web-transcript">
              {!thread?.items.length ? (
                <div className="web-welcome"><img src={logoUrl} alt="" /><h2>What would you like to build?</h2><p>Use the hosted Mused runtime to explore a workspace with live Codex streaming.</p></div>
              ) : (
                thread.items.map((entry) => <div className={'web-message ' + (entry.kind === 'userMessage' ? 'user' : 'agent')} key={entry.itemId}>{itemText(entry)}</div>)
              )}
            </div>
            <div className="web-composer">
              <input className="web-workspace-input" value={workspaceRoot} onChange={(event) => setWorkspaceRoot(event.target.value)} placeholder="/srv/projects/your-repo" aria-label="Workspace path" />
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask Mused to explore or plan a change…" onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
              }} />
              <button className="web-button primary" onClick={() => void send()} disabled={!prompt.trim() || !workspaceRoot.trim() || !connected}>Send</button>
            </div>
          </>
        ) : (
          <>
            <header className="web-header"><div><p className="web-eyebrow">SELF-DEVELOPING ENVIRONMENT</p><h1>Change tasks</h1></div><span className="web-pill">isolated worktrees</span></header>
            <div className="web-task-page">
              <section className="web-card web-task-form">
                <h2>Request a controlled change</h2>
                <p className="web-muted">Mused creates an isolated worktree, runs checks, and starts a preview before approval.</p>
                <label className="web-label" htmlFor="repository-root">Repository path</label>
                <input id="repository-root" value={repositoryRoot} onChange={(event) => setRepositoryRoot(event.target.value)} placeholder="/srv/projects/mused" />
                <label className="web-label" htmlFor="task-prompt">What should change?</label>
                <textarea id="task-prompt" value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} placeholder="Change how this button works…" />
                <label className="web-label" htmlFor="check-command">Validation command</label>
                <input id="check-command" value={checkCommand} onChange={(event) => setCheckCommand(event.target.value)} />
                <button className="web-button primary" onClick={() => void createTask()} disabled={!connected}>Create isolated task</button>
              </section>
              <section className="web-task-list">
                <p className="web-eyebrow">RECENT TASKS</p>
                {tasks.length === 0 ? <p className="web-muted">No change tasks yet.</p> : tasks.map((task) => (
                  <article className="web-task-card" key={task.id}>
                    <div className="web-task-card-header"><strong>{task.prompt}</strong><span className="web-pill">{task.state}</span></div>
                    <p className="web-muted">{task.repositoryRoot}</p>
                    {task.worktreePath && <p className="web-task-path">{task.worktreePath}</p>}
                    {task.preview.url && task.preview.status === 'ready' && <a href={task.preview.url} target="_blank" rel="noreferrer" className="web-button">Open live preview</a>}
                    {task.state === 'requested' && <button className="web-button" onClick={() => void runTask(task)}>Plan, check, and preview</button>}
                    {task.state === 'awaiting-approval' && <button className="web-button primary" onClick={() => void approveTask(task)}>Approve change</button>}
                    {task.error && <p className="web-error">{task.error}</p>}
                  </article>
                ))}
              </section>
            </div>
          </>
        )}
        {error && <p className="web-error" role="alert">{error}</p>}
      </section>
    </main>
  )
}
