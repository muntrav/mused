import { CodexAdapter } from '../main/agent/codex-adapter'
import { FakeAgentAdapter } from '../main/agent/fake-adapter'
import { resolve } from 'node:path'
import { ChangeTaskService } from '../main/workspaces/change-task-service'
import { GatewayServer } from './server'

const secret = process.env.MUSED_GATEWAY_SECRET
if (!secret) throw new Error('Set MUSED_GATEWAY_SECRET before starting the gateway.')

const agent =
  process.env.MUSED_PROVIDER === 'fake'
    ? new FakeAgentAdapter()
    : new CodexAdapter({
        command: process.env.MUSED_CODEX_PATH,
        cwd: process.env.MUSED_CODEX_CWD,
      })

const allowedWorkspaceRoots = (process.env.MUSED_ALLOWED_WORKSPACE_ROOTS ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map(resolve)

const taskService = new ChangeTaskService()
await agent.connect()

const gateway = new GatewayServer({
  port: Number(process.env.MUSED_GATEWAY_PORT ?? 8787),
  bootstrapSecret: secret,
  agent,
  taskService,
  allowedOrigins: process.env.MUSED_GATEWAY_ORIGIN ? [process.env.MUSED_GATEWAY_ORIGIN] : [],
  allowedWorkspaceRoots,
  allowWorkspaceExecution: process.env.MUSED_ALLOW_WORKSPACE_EXECUTION === 'true',
  staticRoot: resolve('dist/web'),
  secureCookies: process.env.NODE_ENV === 'production',
})

const address = await gateway.listen()
console.log('Mused gateway listening on ' + address.host + ':' + address.port)
await new Promise<void>((resolvePromise) => {
  process.once('SIGINT', resolvePromise)
  process.once('SIGTERM', resolvePromise)
})
await gateway.close()
await agent.disconnect()
