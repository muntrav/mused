import type {
  Attachment,
  ConnectionStatus,
  DesktopAPI,
  GitStatus,
  MuseModel,
  MuseSession,
  Preferences,
  ProjectFile,
  QuestionAnswer,
  SessionView,
  UpdateStatus,
} from '../shared/protocol'
import { preferencesSchema } from '../shared/protocol'
import type {
  AgentConnectionStatus,
  AgentEvent,
  AgentItem,
  AgentModel,
  AgentThreadSummary,
  AgentThreadView,
  AuthStatus,
} from '../shared/agent/protocol'
import type { AppEvent } from '../shared/protocol'
import type { GatewayEvent } from '../gateway/protocol'
import { GatewayClient } from './gateway-client'

function session(summary: AgentThreadSummary): MuseSession {
  return {
    sessionId: summary.id,
    workspaceRoot: summary.workspaceRoot,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    lastActivityAt: summary.updatedAt,
    status: summary.status,
    activeTurnId: summary.activeTurnId,
    modelId: summary.modelId,
    name: summary.name,
    title: summary.title,
    firstUserPrompt: summary.firstUserPrompt,
    branch: summary.branch,
    turnCount: summary.turnCount,
  }
}

function item(value: AgentItem) {
  return { ...value, revision: value.revision ?? 0 } as SessionView['items'][number]
}

function view(value: AgentThreadView): SessionView {
  return {
    session: session(value.thread),
    items: value.items.map(item),
    approvals: value.approvals.map((approval) => ({
      approvalId: approval.id,
      sessionId: approval.threadId,
      toolName: approval.toolName,
      rawArgs: approval.rawArgs,
      currentRequirementId: approval.requirementId,
      subject: approval.subject,
      availableChoices: approval.choices.map((choice) => ({
        choiceId: choice.id,
        label: choice.label,
        decision: choice.decision,
        scope: choice.scope,
        rulePreview: choice.rulePreview,
        acceptsFeedback: false,
      })),
    })),
    questions: value.questions.map((question) => ({
      userInputId: question.id,
      sessionId: question.threadId,
      questions: question.questions,
    })),
    usage: value.usage,
    error: value.error,
    historyNotice: value.historyNotice,
  }
}

function model(value: AgentModel): MuseModel {
  return {
    modelId: value.id,
    displayLabel: value.label,
    providerId: value.provider,
    isDefault: value.isDefault,
    isActive: value.isActive,
    contextLimit: value.contextLimit,
    reasoningEffortVariants: value.reasoningEffortVariants,
  }
}

function status(value: AgentConnectionStatus): ConnectionStatus {
  return {
    state: value.state === 'closed' ? 'error' : value.state,
    path: 'Hosted Mused gateway',
    version: value.version,
    message: value.message,
  }
}

function readPreferences(): Preferences {
  try {
    return preferencesSchema.parse(JSON.parse(localStorage.getItem('mused.preferences') || '{}'))
  } catch {
    return preferencesSchema.parse({})
  }
}

const attachmentContents = new Map<string, string>()

export class WebDesktopAPI implements DesktopAPI {
  private readonly client = new GatewayClient()
  private preferences = readPreferences()
  private lastConnection: ConnectionStatus = { state: 'connecting', path: 'Hosted Mused gateway' }

  async updateStatus(): Promise<UpdateStatus> {
    return {
      available: false,
      canCheck: false,
      automaticChecks: false,
      message: 'Updates are delivered through the hosted Mused deployment.',
    }
  }

  async checkForUpdates() {
    return this.updateStatus()
  }

  async setAutomaticUpdateChecks() {
    return this.updateStatus()
  }

  async bootstrap() {
    await this.connect()
    return {
      preferences: this.preferences,
      status: this.lastConnection,
      version: 'hosted',
      home: '',
      platform: 'web',
    }
  }

  async connect() {
    await this.client.connect()
    const result = await this.client.request<{ auth: AuthStatus }>({
      type: 'agent',
      action: 'status',
    })
    this.lastConnection = {
      state: result.auth.state === 'error' ? 'error' : 'ready',
      path: 'Hosted Mused gateway',
      message: result.auth.message,
    }
    return this.lastConnection
  }

  async chooseCli() {
    return null
  }

  async chooseProject() {
    const selected = window.prompt('Workspace path', this.preferences.recentProjects[0] || '')
    return selected?.trim() || null
  }

  async savePreferences(patch: Partial<Preferences>) {
    this.preferences = preferencesSchema.parse({ ...this.preferences, ...patch })
    localStorage.setItem('mused.preferences', JSON.stringify(this.preferences))
    return this.preferences
  }

  async listSessions(cursor?: string) {
    const result = await this.client.request<{
      items: AgentThreadSummary[]
      nextCursor: string | null
    }>({ type: 'agent', action: 'list-threads', input: { cursor } })
    return { sessions: result.items.map(session), nextCursor: result.nextCursor }
  }

  async createSession(project: string, modelId?: string) {
    return view(
      await this.client.request<AgentThreadView>({
        type: 'agent',
        action: 'start-thread',
        input: { workspaceRoot: project, modelId },
      }),
    )
  }

  async openSession(sessionId: string) {
    return view(
      await this.client.request<AgentThreadView>({
        type: 'agent',
        action: 'read-thread',
        input: { threadId: sessionId },
      }),
    )
  }

  async send(input: {
    sessionId: string
    text: string
    attachments: string[]
    effort: Preferences['reasoningEffort']
    mode: 'queue' | 'steer'
  }) {
    const attachmentText = input.attachments
      .map((id) => attachmentContents.get(id))
      .filter(Boolean)
      .join('\n\n')
    await this.client.request({
      type: 'agent',
      action: 'start-turn',
      input: {
        threadId: input.sessionId,
        text: attachmentText
          ? input.text + '\n\nAttached browser files:\n' + attachmentText
          : input.text,
        attachments: input.attachments,
        effort: input.effort,
        mode: input.mode,
      },
    })
  }

  async cancel(sessionId: string) {
    await this.client.request({
      type: 'agent',
      action: 'cancel-turn',
      input: { threadId: sessionId },
    })
  }

  async compact(sessionId: string) {
    return this.client.request<{ status: string }>({
      type: 'agent',
      action: 'compact-thread',
      input: { threadId: sessionId },
    })
  }

  async renameSession(sessionId: string, name: string) {
    await this.client.request({
      type: 'agent',
      action: 'rename-thread',
      input: { threadId: sessionId, name },
    })
  }

  async models(sessionId?: string) {
    const result = await this.client.request<AgentModel[]>({
      type: 'agent',
      action: 'list-models',
      input: sessionId ? { threadId: sessionId } : undefined,
    })
    return result.map(model)
  }

  async setModel(sessionId: string, modelId: string) {
    await this.client.request({
      type: 'agent',
      action: 'set-model',
      input: { threadId: sessionId, modelId },
    })
  }

  async approve(sessionId: string, approvalId: string, choiceId: string) {
    await this.client.request({
      type: 'agent',
      action: 'approve',
      input: { threadId: sessionId, approvalId, choiceId },
    })
  }

  async answer(sessionId: string, userInputId: string, answers: QuestionAnswer[]) {
    await this.client.request({
      type: 'agent',
      action: 'answer',
      input: { threadId: sessionId, questionId: userInputId, answers },
    })
  }

  async cancelQuestion(sessionId: string, userInputId: string) {
    await this.client.request({
      type: 'agent',
      action: 'cancel-question',
      input: { threadId: sessionId, questionId: userInputId },
    })
  }

  async chooseAttachments() {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/*,.txt,.md,.json,.ts,.tsx,.js,.jsx,.css,.html'
    return new Promise<Attachment[]>((resolve) => {
      input.onchange = () => {
        void (async () => {
          const files = Array.from(input.files || []).slice(0, 5)
          const attachments: Attachment[] = []
          for (const file of files) {
            const id = crypto.randomUUID()
            const kind = file.type.startsWith('image/') ? 'image' : 'text'
            if (kind === 'text' && file.size <= 120 * 1024) {
              try {
                attachmentContents.set(id, file.name + ':\n' + (await file.text()))
              } catch {
                attachmentContents.set(id, file.name)
              }
            } else {
              attachmentContents.set(id, '[' + kind + ' attachment: ' + file.name + ']')
            }
            attachments.push({ id, name: file.name, kind, size: file.size })
          }
          resolve(attachments)
        })()
      }
      input.click()
    })
  }

  async removeAttachment(id: string) {
    attachmentContents.delete(id)
  }

  async requestMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Microphone input is unavailable here.')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
  }

  async transcribeVoice() {
    throw new Error(
      'Voice transcription is available in the desktop app. Use typed input on the web.',
    )
  }

  async cancelVoice() {}

  async gitStatus(project: string): Promise<GitStatus> {
    return this.client.request<GitStatus>({
      type: 'workspace',
      action: 'git-status',
      input: { project },
    })
  }

  async gitDiff(project: string, path: string) {
    return this.client.request<string>({
      type: 'workspace',
      action: 'git-diff',
      input: { project, path },
    })
  }

  async listFiles(project: string, directory: string): Promise<ProjectFile[]> {
    return this.client.request<ProjectFile[]>({
      type: 'workspace',
      action: 'list-files',
      input: { project, directory },
    })
  }

  async readFile(project: string, path: string) {
    return this.client.request<string>({
      type: 'workspace',
      action: 'read-file',
      input: { project, path },
    })
  }

  async revealProject() {
    throw new Error('Project reveal is available in the desktop app.')
  }

  async openTerminal() {
    throw new Error('Terminal access is available in the desktop app.')
  }

  async openCli() {
    throw new Error('CLI access is available in the desktop app.')
  }

  async exportSession(sessionId: string) {
    const current = view(
      await this.client.request<AgentThreadView>({
        type: 'agent',
        action: 'read-thread',
        input: { threadId: sessionId },
      }),
    )
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = 'mused-' + sessionId + '.json'
    anchor.click()
    URL.revokeObjectURL(anchor.href)
    return anchor.download
  }

  async readOutput(sessionId: string, itemId: string) {
    return this.client.request<string>({
      type: 'agent',
      action: 'read-output',
      input: { threadId: sessionId, itemId },
    })
  }

  async openExternal(url: string) {
    if (!/^https?:\/\//i.test(url))
      throw new Error('Only HTTPS links can be opened from the web app.')
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async windowAction() {}

  onEvent(callback: (event: AppEvent) => void) {
    return this.client.subscribe((event: GatewayEvent) => {
      if (event.type === 'connected') {
        callback({
          type: 'connection',
          status: { state: 'ready', path: 'Hosted Mused gateway', version: event.provider },
        })
        return
      }
      if (event.type !== 'event') return
      const agentEvent: AgentEvent = event.event
      if (agentEvent.type === 'connection')
        callback({ type: 'connection', status: status(agentEvent.status) })
      if (agentEvent.type === 'thread') callback({ type: 'session', view: view(agentEvent.view) })
      if (agentEvent.type === 'threads-changed') callback({ type: 'sessions-changed' })
      if (agentEvent.type === 'error') callback({ type: 'error', message: agentEvent.message })
    })
  }
}

export function createWebDesktopAPI() {
  return new WebDesktopAPI()
}
