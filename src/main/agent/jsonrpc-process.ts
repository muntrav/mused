import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { JsonRpcLineDecoder, encodeJsonRpc, type JsonRpcMessage, type JsonRpcNotification, type JsonRpcRequest } from './jsonrpc-stdio'

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export type JsonRpcServerRequest = JsonRpcRequest
export type JsonRpcProcessOptions = {
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  onNotification?: (message: JsonRpcNotification) => void
  onRequest?: (message: JsonRpcServerRequest) => Promise<unknown> | unknown
  onStderr?: (chunk: string) => void
}

export class JsonRpcProcess {
  private child?: ChildProcessWithoutNullStreams
  private readonly pending = new Map<string | number, Pending>()
  private readonly decoder = new JsonRpcLineDecoder()
  private nextId = 1
  private closed = false

  async start(options: JsonRpcProcessOptions) {
    if (this.child) return
    this.closed = false
    this.child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child.stdout.on('data', (chunk: Buffer) => {
      try {
        for (const message of this.decoder.push(chunk)) void this.receive(message, options)
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    this.child.stderr.on('data', (chunk: Buffer) => options.onStderr?.(chunk.toString('utf8')))
    this.child.on('error', (error) => this.fail(error))
    this.child.on('exit', (code, signal) => {
      if (!this.closed)
        this.fail(new Error(`JSON-RPC process exited (${code ?? 'unknown'}${signal ? `/${signal}` : ''}).`))
      this.child = undefined
    })
  }

  request(method: string, params?: unknown) {
    const id = this.nextId++
    const message: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.write(message)
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  notify(method: string, params?: unknown) {
    const message: JsonRpcNotification = { jsonrpc: '2.0', method, params }
    this.write(message)
  }

  respond(id: string | number, result?: unknown, error?: { code: number; message: string; data?: unknown }) {
    const message = error
      ? { jsonrpc: '2.0', id, error }
      : { jsonrpc: '2.0', id, result: result ?? {} }
    this.write(message as JsonRpcMessage)
  }

  async close() {
    this.closed = true
    const child = this.child
    this.child = undefined
    if (!child) return
    for (const pending of this.pending.values()) pending.reject(new Error('JSON-RPC process closed.'))
    this.pending.clear()
    child.kill()
    await new Promise<void>((resolve) => child.once('close', () => resolve()))
  }

  private write(message: JsonRpcMessage) {
    if (!this.child || this.closed) throw new Error('JSON-RPC process is not running.')
    this.child.stdin.write(encodeJsonRpc(message))
  }

  private async receive(message: JsonRpcMessage, options: JsonRpcProcessOptions) {
    if ('id' in message && 'method' in message) {
      try {
        const result = await options.onRequest?.(message)
        this.respond(message.id, result)
      } catch (error) {
        this.respond(message.id, undefined, {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        })
      }
      return
    }
    if ('id' in message && !('method' in message)) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
      return
    }
    if (!('id' in message)) options.onNotification?.(message as JsonRpcNotification)
  }

  private fail(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
