import type { AgentAdapter } from '../../shared/agent/adapter'
import type {
  AgentEvent,
  AgentConnectionStatus,
  ProviderId,
  Unsubscribe,
} from '../../shared/agent/protocol'

export class AgentManager {
  private readonly adapters = new Map<ProviderId, AgentAdapter>()
  private readonly listeners = new Set<(event: AgentEvent) => void>()
  private active?: AgentAdapter
  private unsubscribers: Unsubscribe[] = []

  register(adapter: AgentAdapter) {
    this.adapters.set(adapter.provider, adapter)
    return () => {
      if (this.active === adapter) this.active = undefined
      this.adapters.delete(adapter.provider)
    }
  }

  select(provider: ProviderId) {
    const adapter = this.adapters.get(provider)
    if (!adapter) throw new Error(`No adapter is registered for provider “${provider}”.`)
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers = [adapter.subscribe((event) => this.publish(event))]
    this.active = adapter
    return adapter
  }

  current(): AgentAdapter {
    if (!this.active) throw new Error('Select an agent provider before starting a session.')
    return this.active
  }

  async connect(): Promise<AgentConnectionStatus> {
    return this.current().connect()
  }

  async disconnect() {
    await this.current().disconnect()
  }

  subscribe(listener: (event: AgentEvent) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  providers() {
    return [...this.adapters.keys()]
  }

  private publish(event: AgentEvent) {
    for (const listener of this.listeners) listener(event)
  }
}
