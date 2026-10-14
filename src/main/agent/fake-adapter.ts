import { randomUUID } from 'node:crypto'
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
  AgentModel,
  AgentThreadSummary,
  AgentThreadView,
  AuthStatus,
  Page,
  Unsubscribe,
} from '../../shared/agent/protocol'

const fakeModel: AgentModel = {
  id: 'fake-default',
  label: 'Fake agent',
  provider: 'fake',
  isDefault: true,
  isActive: true,
  contextLimit: 128000,
}

class FakeAuthAdapter implements AuthAdapter {
  async status(): Promise<AuthStatus> {
    return { provider: 'fake', state: 'authenticated', message: 'Fake provider is ready.' }
  }

  async login(): Promise<AuthStatus> {
    return this.status()
  }

  async cancelLogin() {}

  async logout() {}
}

export class FakeAgentAdapter implements AgentAdapter {
  readonly provider = 'fake' as const
  readonly capabilities = capabilitiesFor(this.provider)
  readonly auth = new FakeAuthAdapter()
  private readonly threads = new Map<string, AgentThreadView>()
  private readonly listeners = new Set<(event: AgentEvent) => void>()
  private status: AgentConnectionStatus = {
    provider: this.provider,
    state: 'closed',
    reconnectable: true,
  }

  async connect() {
    this.status = {
      provider: this.provider,
      state: 'ready',
      version: 'fake-1',
      reconnectable: true,
    }
    this.publish({ type: 'connection', status: this.status })
    return this.status
  }

  async disconnect() {
    this.status = { provider: this.provider, state: 'closed', reconnectable: true }
    this.publish({ type: 'connection', status: this.status })
  }

  async listThreads(cursor?: string): Promise<Page<AgentThreadSummary>> {
    const values = [...this.threads.values()].map((view) => view.thread)
    const start = cursor ? Number(cursor) : 0
    return {
      items: values.slice(start, start + 100),
      nextCursor: start + 100 < values.length ? String(start + 100) : null,
    }
  }

  async readThread(id: string) {
    const view = this.threads.get(id)
    if (!view) throw new Error('Thread not found.')
    return structuredClone(view)
  }

  async startThread(input: StartThreadInput) {
    const id = randomUUID()
    const now = new Date().toISOString()
    const view: AgentThreadView = {
      thread: {
        id,
        workspaceRoot: input.workspaceRoot,
        createdAt: now,
        updatedAt: now,
        status: 'idle',
        activeTurnId: null,
        modelId: input.modelId ?? fakeModel.id,
        turnCount: 0,
      },
      items: [],
      approvals: [],
      questions: [],
    }
    this.threads.set(id, view)
    this.publish({ type: 'threads-changed' })
    return structuredClone(view)
  }

  async startTurn(input: TurnInput) {
    const view = this.require(input.threadId)
    const now = new Date().toISOString()
    const userItem = {
      itemId: randomUUID(),
      kind: 'userMessage',
      revision: 1,
      status: 'completed',
      text: input.text,
      displayText: input.text,
      recordedAt: now,
    }
    const assistantItem = {
      itemId: randomUUID(),
      kind: 'agentMessage',
      revision: 1,
      status: 'completed',
      text: `Fake response: ${input.text}`,
      recordedAt: now,
    }
    view.items.push(userItem, assistantItem)
    view.thread.turnCount += 1
    view.thread.updatedAt = now
    this.publish({ type: 'thread', view: structuredClone(view) })
  }

  async cancelTurn(threadId: string) {
    const view = this.require(threadId)
    view.thread.activeTurnId = null
    view.thread.status = 'idle'
    this.publish({ type: 'thread', view: structuredClone(view) })
  }

  async respondToApproval(_input: ApprovalResponse) {}
  async respondToQuestion(_input: QuestionResponse) {}

  async listModels() {
    return [fakeModel]
  }

  async renameThread(threadId: string, name: string) {
    const view = this.require(threadId)
    view.thread.name = name
    view.thread.updatedAt = new Date().toISOString()
    this.publish({ type: 'thread', view: structuredClone(view) })
  }

  async setModel(threadId: string, modelId: string) {
    const view = this.require(threadId)
    view.thread.modelId = modelId
    this.publish({ type: 'thread', view: structuredClone(view) })
  }

  async compactThread(threadId: string) {
    this.require(threadId)
    return { status: 'noop' }
  }

  async readOutput(threadId: string, itemId: string) {
    const item = this.require(threadId).items.find((entry) => entry.itemId === itemId)
    if (!item) throw new Error('Output item not found.')
    return item.text ?? item.visibleOutput ?? ''
  }

  subscribe(listener: (event: AgentEvent) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private require(id: string) {
    const view = this.threads.get(id)
    if (!view) throw new Error('Thread not found.')
    return view
  }

  private publish(event: AgentEvent) {
    for (const listener of this.listeners) listener(event)
  }
}
