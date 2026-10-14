import {
  gatewayEventSchema,
  type GatewayEvent,
  type GatewayRequest,
  type GatewayRequestInput,
} from '../gateway/protocol'

export class GatewayClient {
  private socket?: WebSocket
  private readonly listeners = new Set<(event: GatewayEvent) => void>()
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()

  async login(passcode: string) {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passcode }),
    })
    if (!response.ok) throw new Error('Login failed. Check the access code and try again.')
  }

  async session() {
    const response = await fetch('/api/session', { credentials: 'include' })
    return response.ok
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return
    await new Promise<void>((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${window.location.host}`)
      this.socket = socket
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error('Could not connect to the Mused gateway.'))
      socket.onmessage = (message) => this.receive(message.data)
      socket.onclose = () => {
        for (const pending of this.pending.values())
          pending.reject(new Error('Gateway connection closed.'))
        this.pending.clear()
        this.socket = undefined
      }
    })
  }

  async request<T>(input: GatewayRequestInput) {
    await this.connect()
    const requestId = crypto.randomUUID()
    const request = { ...input, requestId } as GatewayRequest
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject })
      this.socket?.send(JSON.stringify(request))
    })
  }

  subscribe(listener: (event: GatewayEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close() {
    this.socket?.close()
    this.socket = undefined
  }

  private receive(raw: string) {
    let event: GatewayEvent
    try {
      event = gatewayEventSchema.parse(JSON.parse(raw))
    } catch {
      return
    }
    if (event.type === 'response') {
      const pending = this.pending.get(event.requestId)
      if (!pending) return
      this.pending.delete(event.requestId)
      if (event.ok) pending.resolve(event.value)
      else pending.reject(new Error(event.error ?? 'Gateway request failed.'))
    }
    for (const listener of this.listeners) listener(event)
  }
}
