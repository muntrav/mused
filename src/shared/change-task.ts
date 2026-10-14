import { z } from 'zod'

export const changeTaskStateSchema = z.enum([
  'requested',
  'planning',
  'editing',
  'checking',
  'previewing',
  'awaiting-approval',
  'applied',
  'reverted',
  'failed',
  'cancelled',
])
export type ChangeTaskState = z.infer<typeof changeTaskStateSchema>

export const changeRiskSchema = z.enum([
  'renderer-copy',
  'renderer-behavior',
  'main-preload',
  'gateway-auth-security',
  'deployment-data-access',
])
export type ChangeRisk = z.infer<typeof changeRiskSchema>

export const changeTaskSchema = z.object({
  id: z.string(),
  repositoryRoot: z.string(),
  worktreePath: z.string().nullable(),
  baselineCommit: z.string().nullable(),
  prompt: z.string().min(1).max(20000),
  plan: z.string().max(50000).nullable(),
  state: changeTaskStateSchema,
  risk: changeRiskSchema,
  changedFiles: z.array(z.string()),
  checks: z.array(
    z.object({
      name: z.string(),
      command: z.string(),
      status: z.enum(['pending', 'running', 'passed', 'failed', 'cancelled']),
      output: z.string().max(200000).optional(),
      exitCode: z.number().nullable().optional(),
    }),
  ),
  preview: z.object({
    status: z.enum(['not-started', 'starting', 'ready', 'unhealthy', 'stopped']),
    url: z.string().url().optional(),
    message: z.string().optional(),
  }),
  approval: z.object({
    required: z.boolean(),
    approved: z.boolean(),
    approvedAt: z.string().optional(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().optional(),
})
export type ChangeTask = z.infer<typeof changeTaskSchema>

export const allowedChangeTransitions: Record<ChangeTaskState, ChangeTaskState[]> = {
  requested: ['planning', 'cancelled'],
  planning: ['editing', 'failed', 'cancelled'],
  editing: ['checking', 'failed', 'cancelled'],
  checking: ['previewing', 'failed', 'cancelled'],
  previewing: ['awaiting-approval', 'failed', 'cancelled'],
  'awaiting-approval': ['applied', 'reverted', 'cancelled'],
  applied: [],
  reverted: [],
  failed: ['planning', 'reverted', 'cancelled'],
  cancelled: [],
}

export function canTransition(from: ChangeTaskState, to: ChangeTaskState) {
  return allowedChangeTransitions[from].includes(to)
}

export function riskRequiresApproval(risk: ChangeRisk) {
  return risk !== 'renderer-copy'
}
