import { WebSocket as ClientWebSocket } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeAgentAdapter } from '../../src/main/agent/fake-adapter'
import { GatewayServer } from '../../src/gateway/server'

const gateways: GatewayServer[] = []

afterEach(async () => {
  for (const gateway of gateways.splice(0)) await gateway.close()
})

describe('authenticated hosted gateway', () => {
  it('keeps health public but protects session and capabilities routes', async () => {
    const gateway = new GatewayServer({
      port: 0,
      bootstrapSecret: 'slice-one-secret',
      agent: new FakeAgentAdapter(),
    })
    gateways.push(gateway)
    const address = await gateway.listen()
    const base = `http://${address.host}:${address.port}`
    expect((await fetch(`${base}/health`)).status).toBe(200)
    expect((await fetch(`${base}/api/session`)).status).toBe(401)
    expect(
      (
        await fetch(`${base}/api/auth/login`, {
          method: 'POST',
          body: JSON.stringify({ passcode: 'wrong' }),
        })
      ).status,
    ).toBe(401)
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passcode: 'slice-one-secret' }),
    })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toMatch(/^mused_session=/)
    const session = await fetch(`${base}/api/session`, { headers: { cookie: cookie ?? '' } })
    expect(await session.json()).toEqual({ authenticated: true })
  })

  it('requires the authenticated cookie for the websocket and preserves request correlation', async () => {
    const gateway = new GatewayServer({
      port: 0,
      bootstrapSecret: 'slice-one-secret',
      agent: new FakeAgentAdapter(),
    })
    gateways.push(gateway)
    const address = await gateway.listen()
    const base = `http://${address.host}:${address.port}`
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ passcode: 'slice-one-secret' }),
    })
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
    const socket = new ClientWebSocket(`ws://${address.host}:${address.port}`, {
      headers: { cookie },
    })
    const events: Array<Record<string, unknown>> = []
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => socket.send(JSON.stringify({ type: 'ping', requestId: 'ping-1' })))
      socket.on('message', (raw) => {
        const event = JSON.parse(raw.toString()) as Record<string, unknown>
        events.push(event)
        if (event.type === 'pong') resolve()
      })
      socket.on('error', reject)
    })
    expect(events[0]?.type).toBe('connected')
    expect(events.at(-1)).toMatchObject({ type: 'pong', requestId: 'ping-1' })
    socket.close()
  })
})
