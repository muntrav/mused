import type {
  AgentAdapter,
  ApprovalResponse,
  AuthAdapter,
  QuestionResponse,
  StartThreadInput,
  TurnInput,
} from '../../shared/agent/adapter'
import { capabilitiesFor } from '../../shared/agent/adapter'
import type {
  AgentConnectionStatus,
  AgentEvent,
  AgentItem,
  AgentModel,
  AgentQuestion,
  AgentThreadSummary,
  AgentThreadView,
  AuthStatus,
  Page,
  Unsubscribe,
} from '../../shared/agent/protocol'
import { JsonRpcProcess, type JsonRpcServerRequest } from './jsonrpc-process'
import type { JsonRpcNotification } from './jsonrpc-stdio'

type PendingInteraction =
  | { kind: 'approval'; threadId: string }
  | { kind: 'question'; threadId: string }

type CodexAccount = { type?: string; planType?: string }
const provider = 'codex' as const

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function now() {
  return new Date().toISOString()
}

function summary(input: Record<string, unknown>): AgentThreadSummary {
  return {
    id: stringValue(input.id),
    workspaceRoot: stringValue(input.cwd || input.workspaceRoot) || null,
    createdAt: stringValue(input.createdAt, now()),
    updatedAt: stringValue(input.updatedAt, now()),
    status: stringValue(input.status, 'idle'),
    activeTurnId: stringValue(input.activeTurnId) || null,
    modelId: stringValue(input.model),
    name: stringValue(input.name) || undefined,
    title: stringValue(input.title) || undefined,
    firstUserPrompt: stringValue(input.firstUserPrompt) || undefined,
    branch: stringValue(input.branch) || undefined,
    turnCount: typeof input.turnCount === 'number' ? input.turnCount : 0,
  }
}

function item(input: unknown, fallbackId = 'codex-item') {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const kind = stringValue(value.type, 'event')
  const text =
    stringValue(value.text) ||
    stringValue(value.aggregatedOutput) ||
    stringValue(value.output) ||
    stringValue(value.diff)
  return {
    itemId: stringValue(value.id, fallbackId),
    kind,
    revision: 1,
    status: stringValue(value.status, 'completed'),
    text: text || undefined,
    displayText: text || undefined,
    visibleOutput: text || undefined,
    commandText: stringValue(value.command) || undefined,
    recordedAt: now(),
    durationMs: typeof value.durationMs === 'number' ? value.durationMs : undefined,
    failureReason:
      value.error && typeof value.error === 'object'
        ? stringValue((value.error as Record<string, unknown>).message)
        : undefined,
    summary: Array.isArray(value.summary)
      ? value.summary.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
  } satisfies AgentItem
}

function model(input: unknown): AgentModel {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  return {
    id: stringValue(value.id, stringValue(value.model)),
    label: stringValue(value.displayName, stringValue(value.name, stringValue(value.id))),
    provider,
    isDefault: Boolean(value.isDefault),
    isActive: value.isActive !== false,
    contextLimit: typeof value.contextWindow === 'number' ? value.contextWindow : null,
    reasoningEffortVariants: Array.isArray(value.supportedReasoningEfforts)
      ? value.supportedReasoningEfforts.map((entry) => ({ tier: stringValue(entry) }))
      : undefined,
  }
}

function accountStatus(account: CodexAccount | null | undefined): AuthStatus {
  if (!account)
    return { provider, state: 'required', message: 'Sign in with ChatGPT to use Codex.' }
  if (account.type === 'apiKey')
    return { provider, state: 'authenticated', message: 'Codex is using an API key.' }
  return {
    provider,
    state: 'authenticated',
    message: account.planType
      ? 'Signed in to ChatGPT (' + account.planType + ').'
      : 'Signed in to ChatGPT.',
  }
}

export type CodexAdapterOptions = {
  command?: string
  args?: string[]
  cwd?: string
  version?: string
}

export class CodexAdapter implements AgentAdapter {
  readonly provider = provider
  readonly capabilities = capabilitiesFor(provider)
  readonly auth: AuthAdapter
  private readonly command: string
  private readonly args: string[]
  private readonly cwd?: string
  private readonly version: string
  private readonly listeners = new Set<(event: AgentEvent) => void>()
  private readonly views = new Map<string, AgentThreadView>()
  private readonly pending = new Map<string | number, PendingInteraction>()
  private rpc?: JsonRpcProcess
  private connection: AgentConnectionStatus = {
    provider,
    state: 'closed',
    reconnectable: true,
  }
  private authState: AuthStatus = {
    provider,
    state: 'required',
    message: 'Sign in with ChatGPT to use Codex.',
  }

  constructor(options: CodexAdapterOptions = {}) {
    this.command = options.command ?? process.env.MUSED_CODEX_PATH ?? 'codex'
    this.args = options.args ?? ['app-server']
    this.cwd = options.cwd
    this.version = options.version ?? 'slice-2'
    this.auth = new CodexAuthAdapter(this)
  }

  async connect(): Promise<AgentConnectionStatus> {
    if (this.rpc && this.connection.state === 'ready') return this.connection
    this.connection = { provider, state: 'connecting', reconnectable: true }
    this.publish({ type: 'connection', status: this.connection })
    const rpc = new JsonRpcProcess()
    this.rpc = rpc
    try {
      await rpc.start({
        command: this.command,
        args: this.args,
        cwd: this.cwd,
        onNotification: (message) => this.handleNotification(message),
        onRequest: (message) => this.handleServerRequest(message),
      })
      await rpc.request('initialize', {
        clientInfo: { name: 'mused', title: 'Mused', version: this.version },
        capabilities: { experimentalApi: false },
      })
      rpc.notify('initialized', {})
      await this.refreshAuth()
      this.connection = {
        provider,
        state: 'ready',
        version: this.version,
        reconnectable: true,
        message: 'Codex app-server is ready.',
      }
      this.publish({ type: 'connection', status: this.connection })
      return this.connection
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await rpc.close().catch(() => undefined)
      this.rpc = undefined
      const missing = /enoent|not found|cannot find/i.test(message)
      this.connection = {
        provider,
        state: missing ? 'missing' : 'error',
        reconnectable: true,
        message: missing
          ? 'Codex CLI was not found. Install Codex or set MUSED_CODEX_PATH.'
          : message,
      }
      this.publish({ type: 'connection', status: this.connection })
      return this.connection
    }
  }

  async disconnect() {
    await this.rpc?.close()
    this.rpc = undefined
    this.connection = { provider, state: 'closed', reconnectable: true }
    this.publish({ type: 'connection', status: this.connection })
  }

  async listThreads(cursor?: string): Promise<Page<AgentThreadSummary>> {
    const result = (await this.call('thread/list', { cursor, limit: 100 })) as Record<string, unknown>
    const rows = Array.isArray(result.data)
      ? result.data
      : Array.isArray(result.threads)
        ? result.threads
        : []
    return {
      items: rows
        .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
        .map(summary),
      nextCursor: stringValue(result.nextCursor) || null,
    }
  }

  async readThread(id: string) {
    const result = (await this.call('thread/read', { threadId: id })) as Record<string, unknown>
    const thread = summary((result.thread ?? result) as Record<string, unknown>)
    const view: AgentThreadView = {
      thread,
      items: this.itemsFrom(result),
      approvals: [],
      questions: [],
    }
    this.views.set(id, view)
    return structuredClone(view)
  }

  async startThread(input: StartThreadInput) {
    const result = (await this.call('thread/start', {
      cwd: input.workspaceRoot,
      model: input.modelId,
    })) as Record<string, unknown>
    const thread = summary((result.thread ?? result) as Record<string, unknown>)
    const view: AgentThreadView = { thread, items: [], approvals: [], questions: [] }
    this.views.set(thread.id, view)
    this.publish({ type: 'threads-changed' })
    return structuredClone(view)
  }

  async startTurn(input: TurnInput) {
    const method = input.mode === 'steer' ? 'turn/steer' : 'turn/start'
    const params =
      input.mode === 'steer'
        ? { threadId: input.threadId, input: [{ type: 'text', text: input.text }] }
        : {
            threadId: input.threadId,
            input: [{ type: 'text', text: input.text }],
            effort: input.effort,
          }
    await this.call(method, params)
  }

  async cancelTurn(threadId: string) {
    await this.call('turn/interrupt', { threadId })
  }

  async respondToApproval(input: ApprovalResponse) {
    const requestId = this.findPending(input.approvalId, 'approval', input.threadId)
    const pending = this.pending.get(requestId)
    if (!pending || pending.kind !== 'approval') throw new Error('This approval is no longer active.')
    const choice = input.choiceId.toLowerCase()
    const decision = choice.includes('session')
      ? 'acceptForSession'
      : choice.includes('decline') || choice.includes('deny')
        ? 'decline'
        : choice.includes('cancel')
          ? 'cancel'
          : 'accept'
    this.rpc?.respond(requestId, { decision })
    this.pending.delete(requestId)
  }

  async respondToQuestion(input: QuestionResponse) {
    const requestId = this.findPending(input.questionId, 'question', input.threadId)
    const pending = this.pending.get(requestId)
    if (!pending || pending.kind !== 'question') throw new Error('This question is no longer active.')
    this.rpc?.respond(requestId, {
      answers: input.answers.map((answer) => ({
        questionId: answer.questionId,
        answer: answer.selectedLabels ?? (answer.selectedLabel ? [answer.selectedLabel] : []),
        freeText: answer.freeText,
      })),
    })
    this.pending.delete(requestId)
  }

  async listModels() {
    const result = (await this.call('model/list', { limit: 100 })) as Record<string, unknown>
    const rows = Array.isArray(result.data) ? result.data : Array.isArray(result.models) ? result.models : []
    return rows.map(model)
  }

  async renameThread(threadId: string, name: string) {
    await this.call('thread/name/set', { threadId, name })
  }

  async setModel(threadId: string, modelId: string) {
    await this.call('thread/model/set', { threadId, model: modelId })
  }

  async compactThread(threadId: string) {
    await this.call('thread/compact/start', { threadId })
    return { status: 'started' }
  }

  async readOutput(threadId: string, itemId: string) {
    const view = this.views.get(threadId) ?? (await this.readThread(threadId))
    const found = view.items.find((entry) => entry.itemId === itemId)
    return found?.text ?? found?.visibleOutput ?? ''
  }

  subscribe(listener: (event: AgentEvent) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async authStatus() {
    return this.authState
  }

  async login(method: 'browser' | 'device' = 'browser') {
    const result = (await this.call('account/login/start', {
      type: method === 'device' ? 'chatgptDeviceCode' : 'chatgpt',
    })) as Record<string, unknown>
    this.authState = {
      provider,
      state: 'logging-in',
      message: method === 'device' ? 'Enter the device code to finish Codex login.' : 'Complete Codex login in your browser.',
      loginUrl: stringValue(result.authUrl, stringValue(result.loginUrl)) || undefined,
      deviceCode: stringValue(result.deviceCode, stringValue(result.userCode)) || undefined,
    }
    this.publish({ type: 'auth', status: this.authState })
    return this.authState
  }

  async cancelLogin() {
    const loginId = this.authState.loginUrl
    if (loginId) await this.call('account/login/cancel', { loginId })
    this.authState = { provider, state: 'required', message: 'Codex login was cancelled.' }
    this.publish({ type: 'auth', status: this.authState })
  }

  async logout() {
    await this.call('account/logout')
    this.authState = { provider, state: 'required', message: 'Signed out of Codex.' }
    this.publish({ type: 'auth', status: this.authState })
  }

  private async refreshAuth() {
    const result = (await this.call('account/read', { refreshToken: false })) as Record<string, unknown>
    this.authState = accountStatus(result.account as CodexAccount | null | undefined)
    this.publish({ type: 'auth', status: this.authState })
  }

  private async call(method: string, params?: unknown) {
    if (!this.rpc) throw new Error('Codex app-server is not connected.')
    return this.rpc.request(method, params)
  }

  private async handleServerRequest(message: JsonRpcServerRequest) {
    const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, unknown>
    const threadId = stringValue(params.threadId)
    if (message.method === 'item/tool/requestUserInput') {
      const questions = Array.isArray(params.questions) ? params.questions : []
      const id = String(message.id)
      this.pending.set(message.id, { kind: 'question', threadId })
      const normalized: AgentQuestion = {
        id,
        threadId,
        questions: questions.map((entry, index) => {
          const value = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
          const options = Array.isArray(value.options)
            ? value.options.map((option) => {
                const itemValue = (option && typeof option === 'object' ? option : {}) as Record<string, unknown>
                return { label: stringValue(itemValue.label), description: stringValue(itemValue.description) }
              })
            : []
          return {
            id: stringValue(value.id, 'question-' + index),
            header: stringValue(value.header, 'Question'),
            question: stringValue(value.question, 'Please provide input.'),
            options,
            selection: { mode: options.length > 1 ? 'single' : 'multiple' },
          }
        }),
      }
      const view = this.ensureView(threadId)
      view.questions = [normalized]
      this.publish({ type: 'thread', view: structuredClone(view) })
      return new Promise<unknown>(() => undefined)
    }
    if (
      message.method === 'item/commandExecution/requestApproval' ||
      message.method === 'item/fileChange/requestApproval' ||
      message.method === 'item/permissions/requestApproval'
    ) {
      const id = String(message.id)
      this.pending.set(message.id, { kind: 'approval', threadId })
      const view = this.ensureView(threadId)
      view.approvals = [
        {
          id,
          threadId,
          toolName: message.method.split('/').slice(-2, -1)[0] ?? 'Codex action',
          rawArgs: JSON.stringify(params),
          requirementId: { approvalId: id, sourceIndex: 0 },
          subject: {
            kind: message.method,
            command: stringValue(params.command) || undefined,
            path: stringValue(params.cwd) || undefined,
          },
          choices: ['accept', 'acceptForSession', 'decline', 'cancel'].map((choice) => ({
            id: choice,
            label: choice === 'acceptForSession' ? 'Allow for session' : choice[0].toUpperCase() + choice.slice(1),
            decision: choice,
            scope: choice === 'acceptForSession' ? 'session' : 'turn',
          })),
        },
      ]
      this.publish({ type: 'thread', view: structuredClone(view) })
      return new Promise<unknown>(() => undefined)
    }
    if (message.method === 'account/chatgptAuthTokens/refresh')
      throw new Error('Mused does not accept externally managed Codex tokens.')
    throw new Error('Unsupported Codex app-server request: ' + message.method)
  }

  private handleNotification(message: JsonRpcNotification) {
    if (message.method === 'account/updated') {
      const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, unknown>
      this.authState = accountStatus((params.account ?? params) as CodexAccount | null)
      this.publish({ type: 'auth', status: this.authState })
      return
    }
    if (message.method === 'account/login/completed') {
      const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, unknown>
      this.authState =
        params.success === true
          ? { provider, state: 'authenticated', message: 'Codex login completed.' }
          : { provider, state: 'error', message: stringValue(params.error, 'Codex login failed.') }
      this.publish({ type: 'auth', status: this.authState })
      return
    }
    const params = (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, unknown>
    const threadId = stringValue(params.threadId)
    if (!threadId) return
    const view = this.ensureView(threadId)
    if (message.method === 'turn/started') {
      const turn = (params.turn ?? {}) as Record<string, unknown>
      view.thread.activeTurnId = stringValue(turn.id) || null
      view.thread.status = 'working'
      this.publish({ type: 'thread', view: structuredClone(view) })
      return
    }
    if (message.method === 'turn/completed') {
      const turn = (params.turn ?? {}) as Record<string, unknown>
      view.thread.activeTurnId = null
      view.thread.status = stringValue(turn.status, 'idle')
      view.thread.updatedAt = now()
      this.publish({ type: 'thread', view: structuredClone(view) })
      return
    }
    if (message.method === 'item/agentMessage/delta') {
      const itemId = stringValue(params.itemId, stringValue(params.id))
      const delta = stringValue(params.delta)
      const current = view.items.find((entry) => entry.itemId === itemId)
      if (current) current.text = (current.text ?? '') + delta
      else view.items.push(item({ id: itemId, type: 'agentMessage', text: delta }, itemId))
      const created = view.items.find((entry) => entry.itemId === itemId)
      if (created) {
        created.displayText = created.text
        created.status = 'inProgress'
      }
      this.publish({ type: 'thread', view: structuredClone(view) })
      return
    }
    if (message.method === 'item/started' || message.method === 'item/completed') {
      const incoming = item(params.item, stringValue(params.itemId))
      const index = view.items.findIndex((entry) => entry.itemId === incoming.itemId)
      if (index >= 0)
        view.items[index] = { ...view.items[index], ...incoming, revision: view.items[index].revision + 1 }
      else view.items.push(incoming)
      this.publish({ type: 'thread', view: structuredClone(view) })
    }
  }

  private ensureView(threadId: string) {
    let view = this.views.get(threadId)
    if (!view) {
      view = {
        thread: {
          id: threadId,
          workspaceRoot: null,
          createdAt: now(),
          updatedAt: now(),
          status: 'idle',
          activeTurnId: null,
          modelId: null,
          turnCount: 0,
        },
        items: [],
        approvals: [],
        questions: [],
      }
      this.views.set(threadId, view)
    }
    return view
  }

  private itemsFrom(result: Record<string, unknown>) {
    const values: unknown[] = []
    if (Array.isArray(result.items)) values.push(...result.items)
    if (Array.isArray(result.turns))
      for (const turn of result.turns) {
        if (turn && typeof turn === 'object' && Array.isArray((turn as Record<string, unknown>).items))
          values.push(...((turn as Record<string, unknown>).items as unknown[]))
      }
    return values.map((entry) => item(entry))
  }

  private findPending(id: string, kind: PendingInteraction['kind'], threadId: string) {
    for (const [requestId, pending] of this.pending) {
      if (pending.kind === kind && pending.threadId === threadId && String(requestId) === id) return requestId
    }
    throw new Error('This interaction is no longer active.')
  }

  private publish(event: AgentEvent) {
    for (const listener of this.listeners) listener(event)
  }
}

class CodexAuthAdapter implements AuthAdapter {
  constructor(private readonly owner: CodexAdapter) {}

  async status() {
    return this.owner.authStatus()
  }

  async login(method: 'browser' | 'device' = 'browser') {
    return this.owner.login(method)
  }

  async cancelLogin() {
    await this.owner.cancelLogin()
  }

  async logout() {
    await this.owner.logout()
  }
}
