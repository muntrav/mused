import type {
  AgentApproval,
  AgentConnectionStatus,
  AgentEvent,
  AgentModel,
  AgentQuestion,
  AgentThreadSummary,
  AgentThreadView,
  AuthStatus,
  CapabilitySet,
  Page,
  ProviderId,
  Unsubscribe,
} from './protocol'

export type StartThreadInput = { workspaceRoot: string; modelId?: string }
export type TurnInput = {
  threadId: string
  text: string
  effort: string
  mode: 'queue' | 'steer'
  attachments?: string[]
}
export type ApprovalResponse = { threadId: string; approvalId: string; choiceId: string }
export type QuestionResponse = {
  threadId: string
  questionId: string
  answers: Array<{
    questionId: string
    selectedLabel?: string
    selectedLabels?: string[]
    freeText?: string
  }>
}

export interface AuthAdapter {
  status(): Promise<AuthStatus>
  login(method?: 'browser' | 'device'): Promise<AuthStatus>
  cancelLogin(): Promise<void>
  logout(): Promise<void>
}

export interface AgentAdapter {
  readonly provider: ProviderId
  readonly capabilities: CapabilitySet
  readonly auth: AuthAdapter
  connect(): Promise<AgentConnectionStatus>
  disconnect(): Promise<void>
  listThreads(cursor?: string): Promise<Page<AgentThreadSummary>>
  readThread(id: string): Promise<AgentThreadView>
  startThread(input: StartThreadInput): Promise<AgentThreadView>
  startTurn(input: TurnInput): Promise<void>
  cancelTurn(threadId: string): Promise<void>
  respondToApproval(input: ApprovalResponse): Promise<void>
  respondToQuestion(input: QuestionResponse): Promise<void>
  listModels(threadId?: string): Promise<AgentModel[]>
  renameThread(threadId: string, name: string): Promise<void>
  setModel(threadId: string, modelId: string): Promise<void>
  compactThread(threadId: string): Promise<{ status: string }>
  readOutput(threadId: string, itemId: string): Promise<string>
  subscribe(listener: (event: AgentEvent) => void): Unsubscribe
}

export function capabilitiesFor(provider: ProviderId): CapabilitySet {
  return {
    threads: true,
    streaming: true,
    approvals: true,
    questions: true,
    cancellation: true,
    modelSelection: true,
    attachments: false,
    browserLogin: provider === 'codex',
    deviceLogin: provider === 'codex',
  }
}

export function agentApprovalToChoice(input: AgentApproval, choiceId: string) {
  const choice = input.choices.find((entry) => entry.id === choiceId)
  if (!choice) throw new Error('This approval changed. Review the current choices and try again.')
  return choice
}

export function questionIsForThread(input: AgentQuestion, threadId: string) {
  return input.threadId === threadId
}
