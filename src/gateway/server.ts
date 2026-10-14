import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import type { AgentAdapter } from '../shared/agent/adapter'
import { agentEventSchema } from '../shared/agent/protocol'
import {
  ChangeTaskService,
  type ApprovedCheck,
  type PreviewInput,
} from '../main/workspaces/change-task-service'
import { ChangeTaskStore } from '../main/workspaces/change-task-store'
import type { ChangeRisk } from '../shared/change-task'
import { gatewayRequestSchema, type GatewayEvent, type GatewayRequest } from './protocol'
import { SelfDevelopmentService } from '../main/self-development/service'

const MAX_BODY_BYTES = 64 * 1024
const MAX_MESSAGE_BYTES = 1024 * 1024
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000

export type GatewayServerOptions = {
  host?: string
  port?: number
  bootstrapSecret: string
  agent: AgentAdapter
  taskStore?: ChangeTaskStore
  taskService?: ChangeTaskService
  selfDevelopment?: SelfDevelopmentService
  allowedOrigins?: string[]
  allowedWorkspaceRoots?: string[]
  allowWorkspaceExecution?: boolean
  staticRoot?: string
  secureCookies?: boolean
}

type Client = { socket: WebSocket; sessionId: string; seq: number }

export class GatewayServer {
  private readonly server: Server
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
  })
  private readonly clients = new Set<Client>()
  private readonly sessions = new Map<string, number>()
  private readonly token: Buffer
  private readonly host: string
  private readonly port: number
  private readonly agent: AgentAdapter
  private readonly tasks: ChangeTaskStore
  private readonly taskService: ChangeTaskService
  private readonly selfDevelopment: SelfDevelopmentService
  private readonly allowedOrigins: Set<string>
  private readonly allowedWorkspaceRoots: string[]
  private readonly allowWorkspaceExecution: boolean
  private readonly staticRoot?: string
  private readonly secureCookies: boolean
  private agentUnsubscribe: () => void
  private taskUnsubscribe: () => void

  constructor(options: GatewayServerOptions) {
    if (!options.bootstrapSecret || options.bootstrapSecret.length < 12)
      throw new Error('Gateway bootstrap secret must contain at least 12 characters.')
    this.host = options.host ?? '127.0.0.1'
    this.port = options.port ?? 8787
    this.agent = options.agent
    this.tasks = options.taskStore ?? new ChangeTaskStore()
    this.taskService = options.taskService ?? new ChangeTaskService(this.tasks)
    this.selfDevelopment = options.selfDevelopment ?? new SelfDevelopmentService()
    this.allowedOrigins = new Set(options.allowedOrigins ?? [])
    this.allowedWorkspaceRoots = options.allowedWorkspaceRoots ?? []
    this.allowWorkspaceExecution = options.allowWorkspaceExecution ?? this.agent.provider === 'fake'
    this.staticRoot = options.staticRoot
    this.secureCookies = options.secureCookies ?? false
    this.token = Buffer.from(options.bootstrapSecret)
    this.agentUnsubscribe = this.agent.subscribe((event) => {
      const parsed = agentEventSchema.parse(event)
      this.broadcast({ type: 'event', seq: 0, event: parsed })
    })
    this.taskUnsubscribe = this.tasks.subscribe((task) =>
      this.broadcast({ type: 'task', seq: 0, task }),
    )
    this.server = createServer((request, response) => void this.handleHttp(request, response))
    this.server.on('upgrade', (request, socket, head) => this.handleUpgrade(request, socket, head))
    this.wss.on('connection', (socket, request) => this.handleConnection(socket, request))
  }

  listen() {
    return new Promise<{ host: string; port: number }>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        this.server.off('error', onError)
        const address = this.server.address()
        if (!address || typeof address === 'string')
          return reject(new Error('Gateway did not expose a TCP address.'))
        resolve({ host: this.host, port: address.port })
      }
      this.server.once('error', onError)
      this.server.once('listening', onListening)
      this.server.listen(this.port, this.host)
    })
  }

  async close() {
    this.agentUnsubscribe()
    this.taskUnsubscribe()
    for (const client of this.clients) client.socket.close(1001, 'Gateway shutting down')
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
    this.wss.close()
  }

  address() {
    const address = this.server.address()
    if (!address || typeof address === 'string') return null
    return { host: this.host, port: address.port }
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse) {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
      if (request.method === 'GET' && url.pathname === '/health') {
        return this.json(response, 200, {
          status: 'ok',
          runtime: 'mused-gateway',
          agentAvailable: true,
        })
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/login')
        return this.login(request, response)
      if (request.method === 'GET' && url.pathname === '/api/session') {
        this.requireHttpSession(request)
        return this.json(response, 200, { authenticated: true })
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        const session = this.sessionFromRequest(request)
        if (session) this.sessions.delete(session)
        response.setHeader(
          'Set-Cookie',
          'mused_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
        )
        return this.json(response, 200, { authenticated: false })
      }
      if (this.staticRoot && request.method === 'GET' && !url.pathname.startsWith('/api/'))
        return this.serveStatic(url.pathname, response)
      this.requireHttpSession(request)
      if (request.method === 'GET' && /^\/api\/tasks\/[^/]+\/preview(?:\/|$)/.test(url.pathname)) {
        const match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/preview(?:\/|$)/)
        if (!match) return this.json(response, 404, { error: 'not_found' })
        return this.taskService.proxyPreview(match[1], request, response)
      }
      if (request.method === 'GET' && url.pathname === '/api/capabilities')
        return this.json(response, 200, {
          provider: this.agent.provider,
          capabilities: this.agent.capabilities,
        })
      return this.json(response, 404, { error: 'not_found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.'
      return this.json(response, /authentication required/i.test(message) ? 401 : 400, {
        error: message,
      })
    }
  }

  private async login(request: IncomingMessage, response: ServerResponse) {
    const payload = await readBody(request)
    const input = JSON.parse(payload) as { passcode?: unknown }
    if (typeof input.passcode !== 'string' || !safeEqual(input.passcode, this.token))
      return this.json(response, 401, { error: 'Invalid login.' })
    const sessionId = randomUUID()
    this.sessions.set(sessionId, Date.now())
    const secure = this.secureCookies ? '; Secure' : ''
    response.setHeader(
      'Set-Cookie',
      `mused_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/${secure}`,
    )
    return this.json(response, 200, { authenticated: true })
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    if (!this.originAllowed(request.headers.origin)) {
      socket.destroy()
      return
    }
    const sessionId = this.sessionFromRequest(request)
    if (!sessionId) {
      socket.destroy()
      return
    }
    this.wss.handleUpgrade(request, socket, head, (client) => {
      this.wss.emit('connection', client, request)
    })
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage) {
    const sessionId = this.sessionFromRequest(request)
    if (!sessionId) return socket.close(1008, 'Authentication required')
    const client: Client = { socket, sessionId, seq: 0 }
    this.clients.add(client)
    this.send(client, {
      type: 'connected',
      seq: 0,
      sessionId,
      provider: this.agent.provider,
      capabilities: this.agent.capabilities,
    })
    socket.on('message', (raw) => void this.handleMessage(client, raw))
    socket.on('close', () => this.clients.delete(client))
    socket.on('error', () => this.clients.delete(client))
  }

  private async handleMessage(client: Client, raw: RawData) {
    try {
      const message = raw.toString()
      if (Buffer.byteLength(message, 'utf8') > MAX_MESSAGE_BYTES)
        throw new Error('Message exceeds the 1 MB limit.')
      const request = gatewayRequestSchema.parse(JSON.parse(message))
      if (request.type === 'ping')
        return this.send(client, {
          type: 'pong',
          seq: 0,
          requestId: request.requestId,
        })
      if (request.type === 'subscribe')
        return this.respond(client, request.requestId, { subscribed: true })
      if (request.type === 'agent') return this.handleAgentRequest(client, request)
      if (request.type === 'task') return this.handleTaskRequest(client, request)
      if (request.type === 'self-update') return this.handleSelfUpdateRequest(client, request)
      throw new Error('Unsupported gateway request.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid gateway request.'
      this.send(client, {
        type: 'response',
        seq: 0,
        requestId: 'unknown',
        ok: false,
        error: message,
      })
    }
  }

  private async handleAgentRequest(
    client: Client,
    request: Extract<GatewayRequest, { type: 'agent' }>,
  ) {
    const input = request.input as Record<string, unknown> | undefined
    if (request.action === 'auth-status')
      return this.respond(client, request.requestId, await this.agent.auth.status())
    if (request.action === 'login')
      return this.respond(
        client,
        request.requestId,
        await this.agent.auth.login(input?.method === 'device' ? 'device' : 'browser'),
      )
    if (request.action === 'cancel-login') {
      await this.agent.auth.cancelLogin()
      return this.respond(client, request.requestId, await this.agent.auth.status())
    }
    if (request.action === 'logout') {
      await this.agent.auth.logout()
      return this.respond(client, request.requestId, await this.agent.auth.status())
    }
    if (request.action === 'status')
      return this.respond(client, request.requestId, {
        provider: this.agent.provider,
        capabilities: this.agent.capabilities,
        auth: await this.agent.auth.status(),
      })
    if (request.action === 'list-threads')
      return this.respond(
        client,
        request.requestId,
        await this.agent.listThreads(typeof input?.cursor === 'string' ? input.cursor : undefined),
      )
    if (request.action === 'start-thread') {
      const workspaceRoot = String(input?.workspaceRoot ?? '')
      if (!workspaceRoot) throw new Error('A workspace root is required.')
      if (!this.allowWorkspaceExecution)
        throw new Error('Workspace execution is not enabled in this gateway phase.')
      if (
        this.allowedWorkspaceRoots.length > 0 &&
        !this.allowedWorkspaceRoots.some((root) => isPathInside(root, workspaceRoot))
      )
        throw new Error('This workspace is not allowed for the current session.')
      return this.respond(
        client,
        request.requestId,
        await this.agent.startThread({ workspaceRoot }),
      )
    }
    if (request.action === 'read-thread')
      return this.respond(
        client,
        request.requestId,
        await this.agent.readThread(String(input?.threadId ?? '')),
      )
    if (request.action === 'start-turn')
      return this.respond(
        client,
        request.requestId,
        await this.agent.startTurn({
          threadId: String(input?.threadId ?? ''),
          text: String(input?.text ?? ''),
          effort: String(input?.effort ?? 'high'),
          mode: input?.mode === 'steer' ? 'steer' : 'queue',
        }),
      )
    return this.respond(
      client,
      request.requestId,
      await this.agent.cancelTurn(String(input?.threadId ?? '')),
    )
  }

  private async handleTaskRequest(
    client: Client,
    request: Extract<GatewayRequest, { type: 'task' }>,
  ) {
    const input = request.input as Record<string, unknown> | undefined
    if (request.action === 'list') return this.respond(client, request.requestId, this.tasks.list())
    if (request.action === 'get')
      return this.respond(client, request.requestId, this.tasks.get(String(input?.taskId ?? '')))
    if (request.action === 'create')
      return this.respond(
        client,
        request.requestId,
        await this.taskService.create({
          repositoryRoot: String(input?.repositoryRoot ?? ''),
          prompt: String(input?.prompt ?? ''),
          risk: input?.risk as ChangeRisk | undefined,
          baseRef: typeof input?.baseRef === 'string' ? input.baseRef : undefined,
        }),
      )
    const taskId = String(input?.taskId ?? '')
    if (request.action === 'plan')
      return this.respond(
        client,
        request.requestId,
        this.taskService.plan(taskId, String(input?.plan ?? '')),
      )
    if (request.action === 'check')
      return this.respond(
        client,
        request.requestId,
        await this.taskService.runChecks(
          taskId,
          (input?.checks ?? []) as ApprovedCheck[],
          input?.preview as PreviewInput | undefined,
        ),
      )
    if (request.action === 'diff')
      return this.respond(client, request.requestId, await this.taskService.diff(taskId))
    if (request.action === 'preview')
      return this.respond(client, request.requestId, this.taskService.preview(taskId))
    if (request.action === 'approve')
      return this.respond(client, request.requestId, this.taskService.approve(taskId))
    return this.respond(client, request.requestId, await this.taskService.cancel(taskId))
  }

  private async handleSelfUpdateRequest(
    client: Client,
    request: Extract<GatewayRequest, { type: 'self-update' }>,
  ) {
    const input = request.input as Record<string, unknown> | undefined
    const actor = client.sessionId
    if (request.action === 'list')
      return this.respond(client, request.requestId, await this.selfDevelopment.list())
    if (request.action === 'get')
      return this.respond(
        client,
        request.requestId,
        await this.selfDevelopment.get(String(input?.updateId ?? '')),
      )
    if (request.action === 'audit')
      return this.respond(
        client,
        request.requestId,
        await this.selfDevelopment.auditTrail(String(input?.updateId ?? '')),
      )
    if (request.action === 'propose')
      return this.respond(
        client,
        request.requestId,
        await this.selfDevelopment.propose(input as never, actor),
      )
    if (request.action === 'approve')
      return this.respond(
        client,
        request.requestId,
        await this.selfDevelopment.approve(String(input?.updateId ?? ''), actor),
      )
    if (request.action === 'promote')
      return this.respond(
        client,
        request.requestId,
        await this.selfDevelopment.promote(String(input?.updateId ?? ''), actor),
      )
    if (request.action === 'verify')
      return this.respond(
        client,
        request.requestId,
        await this.selfDevelopment.verify(String(input?.updateId ?? ''), actor),
      )
    if (request.action === 'rollback')
      return this.respond(
        client,
        request.requestId,
        await this.selfDevelopment.rollback(String(input?.updateId ?? ''), actor),
      )
    return this.respond(
      client,
      request.requestId,
      await this.selfDevelopment.cancel(String(input?.updateId ?? ''), actor),
    )
  }

  private respond(client: Client, requestId: string, value: unknown) {
    this.send(client, { type: 'response', seq: 0, requestId, ok: true, value })
  }

  private broadcast(event: GatewayEvent) {
    for (const client of this.clients) {
      if (client.socket.readyState === WebSocket.OPEN) this.send(client, event)
    }
  }

  private send(client: Client, event: GatewayEvent) {
    client.seq += 1
    client.socket.send(JSON.stringify({ ...event, seq: client.seq }))
  }

  private sessionFromRequest(request: IncomingMessage) {
    const cookie = request.headers.cookie
      ?.split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('mused_session='))
    const session = cookie?.slice('mused_session='.length)
    if (!session || !this.sessions.has(session)) return null
    const createdAt = this.sessions.get(session) ?? 0
    if (Date.now() - createdAt > SESSION_MAX_AGE_MS) {
      this.sessions.delete(session)
      return null
    }
    this.sessions.set(session, Date.now())
    return session
  }

  private requireHttpSession(request: IncomingMessage) {
    if (!this.sessionFromRequest(request)) throw new Error('Authentication required.')
  }

  private originAllowed(origin: string | undefined) {
    return (
      this.allowedOrigins.size === 0 || (origin !== undefined && this.allowedOrigins.has(origin))
    )
  }

  private async serveStatic(pathname: string, response: ServerResponse) {
    if (!this.staticRoot) return this.json(response, 404, { error: 'not_found' })
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const path = normalize(join(this.staticRoot, relative))
    if (!isPathInside(this.staticRoot, path))
      return this.json(response, 404, { error: 'not_found' })
    try {
      const content = await readFile(path)
      response.statusCode = 200
      response.setHeader('Content-Type', contentType(extname(path)))
      response.end(content)
    } catch {
      return this.json(response, 404, { error: 'not_found' })
    }
  }

  private json(response: ServerResponse, status: number, body: unknown) {
    response.statusCode = status
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify(body))
  }
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('Request body exceeds the 64 KB limit.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function safeEqual(value: string, expected: Buffer) {
  const candidate = Buffer.from(value)
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

function contentType(extension: string) {
  return (
    (
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
      } as Record<string, string>
    )[extension] ?? 'application/octet-stream'
  )
}

function isPathInside(root: string, target: string) {
  const base = normalize(root).replace(/[\\/]$/, '')
  const candidate = normalize(target)
  return candidate === base || candidate.startsWith(`${base}/`) || candidate.startsWith(`${base}\\`)
}
