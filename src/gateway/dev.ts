import { FakeAgentAdapter } from '../main/agent/fake-adapter'
import { resolve } from 'node:path'
import { GatewayServer } from './server'

const secret = process.env.MUSED_GATEWAY_SECRET
if (!secret) throw new Error('Set MUSED_GATEWAY_SECRET before starting the gateway.')

const gateway = new GatewayServer({
  port: Number(process.env.MUSED_GATEWAY_PORT ?? 8787),
  bootstrapSecret: secret,
  agent: new FakeAgentAdapter(),
  allowedOrigins: process.env.MUSED_GATEWAY_ORIGIN ? [process.env.MUSED_GATEWAY_ORIGIN] : [],
  staticRoot: resolve('dist/web'),
})

const address = await gateway.listen()
console.log(`Mused gateway listening on ${address.host}:${address.port}`)
await new Promise<void>((resolve) => {
  process.once('SIGINT', resolve)
  process.once('SIGTERM', resolve)
})
await gateway.close()
