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
} from '../../shared/agent/protocol'
import type { AppEvent, MuseModel, MuseSession, SessionView } from '../../shared/protocol'
import { MuseHost } from '../muse-host'

function thread(session: MuseSession): AgentThreadSummary {
  return {
    id: session.sessionId,
    workspaceRoot: session.workspaceRoot,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status,
    activeTurnId: session.activeTurnId,
    modelId: session.modelId,
    name: session.name,
    title: session.title,
    firstUserPrompt: session.firstUserPrompt,
    branch: session.branch,
    turnCount: session.turnCount,
  }
}

function view(input: SessionView): AgentThreadView {
  return {
    thread: thread(input.session),
    items: input.items,
    approvals: input.approvals.map((approval) => ({
      id: approval.approvalId,
      threadId: approval.sessionId,
      toolName: approval.toolName,
      rawArgs: approval.rawArgs,
      requirementId: approval.currentRequirementId,
      subject: approval.subject,
      choices: approval.availableChoices.map((choice) => ({
        id: choice.choiceId,
        label: choice.label,
        decision: choice.decision,
        scope: choice.scope,
        rulePreview: choice.rulePreview,
        acceptsFeedback: choice.acceptsFeedback,
      })),
    })),
    questions: input.questions.map((question) => ({
      id: question.userInputId,
      threadId: question.sessionId,
      questions: question.questions,
    })),
    usage: input.usage,
    error: input.error,
    historyNotice: input.historyNotice,
  }
}

function model(input: MuseModel): AgentModel {
  return {
    id: input.modelId,
    label: input.displayLabel,
    provider: input.providerId,
    isDefault: input.isDefault,
    isActive: input.isActive,
    contextLimit: input.contextLimit,
    reasoningEffortVariants: input.reasoningEffortVariants,
  }
}

function connection(
  provider: 'muse',
  status: { state: string; version?: string; message?: string },
): AgentConnectionStatus {
  const state = ['connecting', 'ready', 'missing', 'error'].includes(status.state)
    ? (status.state as AgentConnectionStatus['state'])
    : 'error'
  return { provider, state, version: status.version, message: status.message, reconnectable: true }
}

export class MuseAdapter implements AgentAdapter {
  readonly provider = 'muse' as const
  readonly capabilities = capabilitiesFor(this.provider)
  readonly auth = new MuseAuthAdapter()
  private listeners = new Set<(event: AgentEvent) => void>()

  constructor(
    private readonly host: MuseHost,
    private readonly cliPath = '',
  ) {
    host.subscribe((event) => this.emit(event))
  }

  async connect(): Promise<AgentConnectionStatus> {
    const status = await this.host.connect(this.cliPath)
    return connection(this.provider, status)
  }

  async disconnect() {
    await this.host.close()
  }

  async listThreads(cursor?: string): Promise<Page<AgentThreadSummary>> {
    const result = await this.host.list(cursor)
    return {
      items: result.sessions.filter((entry) => entry.kind !== 'subagent').map(thread),
      nextCursor: result.nextCursor,
    }
  }

  async readThread(id: string) {
    return view(await this.host.open(id))
  }

  async startThread(input: StartThreadInput) {
    return view(await this.host.create(input.workspaceRoot, input.modelId))
  }

  async startTurn(input: TurnInput) {
    await this.host.send(
      input.threadId,
      [{ type: 'text', text: input.text }],
      input.effort,
      input.mode,
      input.text,
    )
  }

  async cancelTurn(threadId: string) {
    await this.host.cancel(threadId)
  }

  async respondToApproval(input: ApprovalResponse) {
    const current = this.host
      .getView(input.threadId)
      .approvals.find((entry) => entry.approvalId === input.approvalId)
    if (!current)
      throw new Error('This approval changed. Review the current choices and try again.')
    await this.host.approve(input.threadId, input.approvalId, input.choiceId)
  }

  async respondToQuestion(input: QuestionResponse) {
    await this.host.answer(input.threadId, input.questionId, input.answers)
  }

  async listModels(threadId?: string) {
    return (await this.host.models(threadId)).map(model)
  }

  async renameThread(threadId: string, name: string) {
    await this.host.rename(threadId, name)
  }

  async setModel(threadId: string, modelId: string) {
    await this.host.setModel(threadId, modelId)
  }

  async compactThread(threadId: string) {
    return this.host.compact(threadId)
  }

  async readOutput(threadId: string, itemId: string) {
    return this.host.readOutput(threadId, itemId)
  }

  subscribe(listener: (event: AgentEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: AppEvent) {
    if (event.type === 'connection')
      this.publish({ type: 'connection', status: connection(this.provider, event.status) })
    if (event.type === 'session') this.publish({ type: 'thread', view: view(event.view) })
    if (event.type === 'sessions-changed') this.publish({ type: 'threads-changed' })
    if (event.type === 'error')
      this.publish({ type: 'error', code: 'provider_error', message: event.message })
  }

  private publish(event: AgentEvent) {
    for (const listener of this.listeners) listener(event)
  }
}

class MuseAuthAdapter implements AuthAdapter {
  async status(): Promise<AuthStatus> {
    return {
      provider: 'muse',
      state: 'managed',
      message: 'Authentication is managed by the installed Muse CLI.',
    }
  }

  async login(): Promise<AuthStatus> {
    return this.status()
  }

  async cancelLogin() {}

  async logout() {
    throw new Error('Muse authentication must be managed by the installed CLI.')
  }
}
