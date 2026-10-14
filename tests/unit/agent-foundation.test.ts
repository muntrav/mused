import { describe, expect, it } from 'vitest'
import { FakeAgentAdapter } from '../../src/main/agent/fake-adapter'
import { AgentManager } from '../../src/main/agent/manager'
import {
  decodeJsonRpc,
  encodeJsonRpc,
  JsonRpcLineDecoder,
} from '../../src/main/agent/jsonrpc-stdio'

describe('provider-neutral agent foundation', () => {
  it('normalizes a fake provider through the shared adapter contract', async () => {
    const adapter = new FakeAgentAdapter()
    const events: string[] = []
    adapter.subscribe((event) => events.push(event.type))
    expect((await adapter.connect()).state).toBe('ready')
    const view = await adapter.startThread({ workspaceRoot: '/workspace' })
    await adapter.startTurn({
      threadId: view.thread.id,
      text: 'Hello',
      effort: 'high',
      mode: 'queue',
    })
    expect((await adapter.readThread(view.thread.id)).items).toHaveLength(2)
    expect(events).toEqual(['connection', 'threads-changed', 'thread'])
  })

  it('routes provider events through the manager without provider-specific types', async () => {
    const manager = new AgentManager()
    const adapter = new FakeAgentAdapter()
    manager.register(adapter)
    manager.select('fake')
    expect(manager.providers()).toEqual(['fake'])
    expect((await manager.connect()).provider).toBe('fake')
  })

  it('bounds and decodes JSON-RPC stdio messages', () => {
    const request = { jsonrpc: '2.0' as const, id: 1, method: 'initialize', params: { version: 1 } }
    const decoder = new JsonRpcLineDecoder()
    expect(decoder.push(encodeJsonRpc(request))).toEqual([request])
    expect(decodeJsonRpc('{"jsonrpc":"2.0","method":"ready"}')).toEqual({
      jsonrpc: '2.0',
      method: 'ready',
    })
    expect(() => encodeJsonRpc({ ...request, params: 'x'.repeat(1024 * 1024) })).toThrow('1 MB')
  })
})
