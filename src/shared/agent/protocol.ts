import { z } from 'zod'

export const providerIdSchema = z.string().min(1).max(80)
export type ProviderId = z.infer<typeof providerIdSchema>

export const connectionStateSchema = z.enum(['connecting', 'ready', 'missing', 'error', 'closed'])
export type AgentConnectionState = z.infer<typeof connectionStateSchema>

export const agentConnectionStatusSchema = z.object({
  state: connectionStateSchema,
  provider: providerIdSchema,
  version: z.string().optional(),
  message: z.string().optional(),
  reconnectable: z.boolean().default(true),
})
export type AgentConnectionStatus = z.infer<typeof agentConnectionStatusSchema>

export const authStateSchema = z.enum([
  'managed',
  'authenticated',
  'required',
  'logging-in',
  'error',
])
export type AuthState = z.infer<typeof authStateSchema>

export const authStatusSchema = z.object({
  provider: providerIdSchema,
  state: authStateSchema,
  message: z.string().optional(),
  loginUrl: z.string().url().optional(),
  deviceCode: z.string().max(200).optional(),
})
export type AuthStatus = z.infer<typeof authStatusSchema>

export const capabilitySetSchema = z.object({
  threads: z.boolean(),
  streaming: z.boolean(),
  approvals: z.boolean(),
  questions: z.boolean(),
  cancellation: z.boolean(),
  modelSelection: z.boolean(),
  attachments: z.boolean(),
  browserLogin: z.boolean(),
  deviceLogin: z.boolean(),
})
export type CapabilitySet = z.infer<typeof capabilitySetSchema>

export const agentThreadSummarySchema = z.object({
  id: z.string(),
  workspaceRoot: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.string(),
  activeTurnId: z.string().nullable(),
  modelId: z.string().nullable(),
  name: z.string().optional(),
  title: z.string().optional(),
  firstUserPrompt: z.string().optional(),
  branch: z.string().optional(),
  turnCount: z.number(),
})
export type AgentThreadSummary = z.infer<typeof agentThreadSummarySchema>

export const agentItemSchema = z.object({
  itemId: z.string(),
  kind: z.string(),
  revision: z.number(),
  status: z.string(),
  turnId: z.string().nullish(),
  text: z.string().optional(),
  displayText: z.string().optional(),
  summary: z.array(z.string()).optional(),
  tool: z.string().optional(),
  args: z.string().optional(),
  visibleOutput: z.string().optional(),
  commandText: z.string().optional(),
  fallbackText: z.string().optional(),
  statusLine: z.string().optional(),
  failureReason: z.string().optional(),
  role: z.string().optional(),
  blocking: z.boolean().optional(),
  durationMs: z.number().optional(),
  recordedAt: z.string().optional(),
  truncated: z.boolean().optional(),
  retracted: z.boolean().optional(),
  label: z.string().optional(),
  finalSummary: z.string().optional(),
  outputRef: z.object({ id: z.string(), byteLen: z.number().optional() }).passthrough().optional(),
  result: z
    .object({ text: z.string().optional(), summary: z.string().optional() })
    .passthrough()
    .optional(),
})
export type AgentItem = z.infer<typeof agentItemSchema>

export const agentApprovalSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  toolName: z.string(),
  rawArgs: z.string(),
  requirementId: z.object({ approvalId: z.string(), sourceIndex: z.number() }),
  subject: z.object({
    kind: z.string(),
    command: z.string().optional(),
    path: z.string().optional(),
    host: z.string().optional(),
    target: z.string().optional(),
  }),
  choices: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      decision: z.string(),
      scope: z.string(),
      rulePreview: z.string().optional(),
      acceptsFeedback: z.boolean().optional(),
    }),
  ),
})
export type AgentApproval = z.infer<typeof agentApprovalSchema>

export const agentQuestionSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  questions: z.array(
    z.object({
      id: z.string(),
      header: z.string(),
      question: z.string(),
      options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
      selection: z.object({
        mode: z.enum(['single', 'multiple']),
        minSelections: z.number().optional(),
        maxSelections: z.number().optional(),
      }),
    }),
  ),
})
export type AgentQuestion = z.infer<typeof agentQuestionSchema>

export const agentModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: providerIdSchema,
  isDefault: z.boolean(),
  isActive: z.boolean(),
  contextLimit: z.number().nullable(),
  reasoningEffortVariants: z
    .array(z.object({ tier: z.string(), description: z.string().optional() }))
    .optional(),
})
export type AgentModel = z.infer<typeof agentModelSchema>

export const agentThreadViewSchema = z.object({
  thread: agentThreadSummarySchema,
  items: z.array(agentItemSchema),
  approvals: z.array(agentApprovalSchema),
  questions: z.array(agentQuestionSchema),
  usage: z.object({ input: z.number(), output: z.number(), total: z.number() }).optional(),
  error: z.string().optional(),
  historyNotice: z.string().optional(),
})
export type AgentThreadView = z.infer<typeof agentThreadViewSchema>

export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('connection'), status: agentConnectionStatusSchema }),
  z.object({ type: z.literal('auth'), status: authStatusSchema }),
  z.object({ type: z.literal('thread'), view: agentThreadViewSchema }),
  z.object({ type: z.literal('threads-changed') }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
])
export type AgentEvent = z.infer<typeof agentEventSchema>

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() })

export type Page<T> = { items: T[]; nextCursor: string | null }

export type Unsubscribe = () => void
