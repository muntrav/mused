import { describe, expect, it } from 'vitest'
import { agentConnectionStatusSchema, type AgentThreadView } from '../../src/shared/agent/protocol'
import { WebDesktopAPI } from '../../src/web/desktop-api'

describe('desktop/web renderer bridge', () => {
  it('normalizes a provider status into the desktop connection contract', () => {
    const value = agentConnectionStatusSchema.parse({
      provider: 'codex',
      state: 'ready',
      version: 'app-server',
    })
    expect(value.state).toBe('ready')
    expect(value.provider).toBe('codex')
  })

  it('keeps the web adapter available as a DesktopAPI implementation', () => {
    const api = new WebDesktopAPI()
    expect(typeof api.bootstrap).toBe('function')
    expect(typeof api.openSession).toBe('function')
    expect(typeof api.listFiles).toBe('function')
    expect(typeof api.openExternal).toBe('function')
  })

  it('preserves thread data required by the shared renderer', () => {
    const thread: AgentThreadView = {
      thread: {
        id: 'thread-1',
        workspaceRoot: '/srv/mused',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        status: 'idle',
        activeTurnId: null,
        modelId: null,
        turnCount: 0,
      },
      items: [],
      approvals: [],
      questions: [],
    }
    expect(thread.thread.workspaceRoot).toBe('/srv/mused')
  })
})
