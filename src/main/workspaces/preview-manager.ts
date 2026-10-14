import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import type { WorkspaceDescriptor } from './worktree-manager'

export type PreviewDescriptor = {
  taskId: string
  port: number
  url: string
  command: string
  args: string[]
  status: 'starting' | 'ready' | 'unhealthy' | 'stopped'
}

type PreviewProcess = PreviewDescriptor & { process: ChildProcess }
const allowedCommands = new Set(['npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd', 'vite'])

export class PreviewManager {
  private readonly previews = new Map<string, PreviewProcess>()

  async start(
    workspace: WorkspaceDescriptor,
    input: { command?: string; args?: string[]; port?: number; healthPath?: string },
  ) {
    await this.stop(workspace.taskId)
    const command = input.command ?? 'npm'
    if (!allowedCommands.has(command))
      throw new Error('Preview commands must use npm, pnpm, yarn, or vite.')
    const port = input.port ?? (await freePort())
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('Preview port must be between 1024 and 65535.')
    const args = [...(input.args ?? [])]
    if (!args.includes('--host')) args.push('--host', '127.0.0.1')
    if (!args.includes('--port')) args.push('--port', String(port))
    if (args.some((arg) => [';', '&', '|', '$', '<', '>'].some((token) => arg.includes(token))))
      throw new Error('Preview arguments contain shell metacharacters.')
    const child = spawn(command, args, {
      cwd: workspace.worktreePath,
      env: { ...process.env, CI: '1', HOST: '127.0.0.1', PORT: String(port) },
      stdio: 'ignore',
      detached: false,
      windowsHide: true,
    })
    const descriptor: PreviewDescriptor = {
      taskId: workspace.taskId,
      port,
      url: '/api/tasks/' + workspace.taskId + '/preview',
      command,
      args,
      status: 'starting',
    }
    const preview: PreviewProcess = { ...descriptor, process: child }
    this.previews.set(workspace.taskId, preview)
    child.once('exit', () => {
      const current = this.previews.get(workspace.taskId)
      if (current?.process === child) current.status = 'stopped'
    })
    await waitForHttp(port, input.healthPath ?? '/', 30000)
    preview.status = 'ready'
    return this.describe(preview)
  }

  get(taskId: string) {
    const preview = this.previews.get(taskId)
    return preview ? this.describe(preview) : null
  }

  async stop(taskId: string) {
    const preview = this.previews.get(taskId)
    if (!preview) return
    this.previews.delete(taskId)
    if (!preview.process.killed) {
      preview.process.kill('SIGTERM')
      await once(preview.process, 'exit').catch(() => undefined)
    }
  }

  async proxy(taskId: string, request: IncomingMessage, response: ServerResponse) {
    const preview = this.previews.get(taskId)
    if (!preview || preview.status !== 'ready') {
      response.statusCode = 404
      response.end('Preview is not ready.')
      return
    }
    const path = request.url?.replace(/^\/api\/tasks\/[^/]+\/preview/, '') || '/'
    const upstream = httpRequest(
      {
        host: '127.0.0.1',
        port: preview.port,
        path: path.startsWith('/') ? path : '/' + path,
        method: request.method,
        headers: { ...request.headers, host: '127.0.0.1:' + preview.port },
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        upstreamResponse.pipe(response)
      },
    )
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502)
      response.end('Preview is unavailable.')
    })
    request.pipe(upstream)
  }

  private describe(preview: PreviewProcess): PreviewDescriptor {
    return {
      taskId: preview.taskId,
      port: preview.port,
      url: preview.url,
      command: preview.command,
      args: preview.args,
      status: preview.status,
    }
  }
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not allocate a preview port.'))
        return
      }
      const port = address.port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

async function waitForHttp(port: number, path: string, timeout: number) {
  const deadline = Date.now() + timeout
  let lastError = 'Preview did not become ready.'
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const request = httpRequest(
          { host: '127.0.0.1', port, path, method: 'GET' },
          (response) => {
            response.resume()
            response.statusCode && response.statusCode < 500
              ? resolve()
              : reject(new Error('Preview returned an unhealthy status.'))
          },
        )
        request.once('error', reject)
        request.end()
      })
      return
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(lastError)
}
