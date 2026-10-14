import { z } from 'zod'

const requestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.string().min(1),
  params: z.unknown().optional(),
})
const responseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: z
    .object({ code: z.number(), message: z.string(), data: z.unknown().optional() })
    .optional(),
})
const notificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string().min(1),
  params: z.unknown().optional(),
})

export type JsonRpcRequest = z.infer<typeof requestSchema>
export type JsonRpcResponse = z.infer<typeof responseSchema>
export type JsonRpcNotification = z.infer<typeof notificationSchema>
export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification

export const MAX_JSONRPC_LINE_BYTES = 1024 * 1024

export function encodeJsonRpc(message: JsonRpcMessage) {
  const encoded = JSON.stringify(message)
  if (Buffer.byteLength(encoded, 'utf8') > MAX_JSONRPC_LINE_BYTES)
    throw new Error('JSON-RPC message exceeds the 1 MB transport limit.')
  return `${encoded}\n`
}

export function decodeJsonRpc(line: string): JsonRpcMessage {
  if (Buffer.byteLength(line, 'utf8') > MAX_JSONRPC_LINE_BYTES)
    throw new Error('JSON-RPC message exceeds the 1 MB transport limit.')
  const value: unknown = JSON.parse(line)
  const parsed = requestSchema.safeParse(value)
  if (parsed.success) return parsed.data
  const response = responseSchema.safeParse(value)
  if (response.success) return response.data
  const notification = notificationSchema.safeParse(value)
  if (notification.success) return notification.data
  throw new Error('Invalid JSON-RPC 2.0 message.')
}

export class JsonRpcLineDecoder {
  private buffer = ''

  push(chunk: string | Uint8Array) {
    this.buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_JSONRPC_LINE_BYTES * 2)
      throw new Error('JSON-RPC input buffer exceeds the transport limit.')
    const messages: JsonRpcMessage[] = []
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      if (line.trim()) messages.push(decodeJsonRpc(line))
      newline = this.buffer.indexOf('\n')
    }
    return messages
  }
}
