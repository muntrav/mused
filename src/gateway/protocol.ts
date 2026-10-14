import { z } from 'zod'
import { agentEventSchema, capabilitySetSchema, providerIdSchema } from '../shared/agent/protocol'
import { changeTaskSchema } from '../shared/change-task'

export const gatewayRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping'), requestId: z.string().min(1).max(100) }),
  z.object({ type: z.literal('subscribe'), requestId: z.string().min(1).max(100) }),
  z.object({
    type: z.literal('agent'),
    requestId: z.string().min(1).max(100),
    action: z.enum([
      'status',
      'list-threads',
      'start-thread',
      'read-thread',
      'start-turn',
      'cancel-turn',
      'auth-status',
      'login',
      'cancel-login',
      'logout',
    ]),
    input: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('task'),
    requestId: z.string().min(1).max(100),
    action: z.enum([
      'list',
      'create',
      'get',
      'plan',
      'check',
      'diff',
      'preview',
      'approve',
      'cancel',
    ]),
    input: z.unknown().optional(),
  }),
])
export type GatewayRequest = z.infer<typeof gatewayRequestSchema>
export type GatewayRequestInput =
  | { type: 'ping' }
  | { type: 'subscribe' }
  | {
      type: 'agent'
      action:
        | 'status'
        | 'list-threads'
        | 'start-thread'
        | 'read-thread'
        | 'start-turn'
        | 'cancel-turn'
        | 'auth-status'
        | 'login'
        | 'cancel-login'
        | 'logout'
      input?: unknown
    }
  | {
      type: 'task'
      action:
        'list' | 'create' | 'get' | 'plan' | 'check' | 'diff' | 'preview' | 'approve' | 'cancel'
      input?: unknown
    }

export const gatewayEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('connected'),
    seq: z.number(),
    sessionId: z.string(),
    provider: providerIdSchema,
    capabilities: capabilitySetSchema,
  }),
  z.object({
    type: z.literal('response'),
    seq: z.number(),
    requestId: z.string(),
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({ type: z.literal('event'), seq: z.number(), event: agentEventSchema }),
  z.object({ type: z.literal('task'), seq: z.number(), task: changeTaskSchema }),
  z.object({ type: z.literal('pong'), seq: z.number(), requestId: z.string() }),
])
export type GatewayEvent = z.infer<typeof gatewayEventSchema>
