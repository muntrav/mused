import { randomUUID } from 'node:crypto'
import {
  approvalPolicy,
  classifyChange,
  isSafeHealthUrl,
  selfUpdateRecordSchema,
  type SelfUpdateRecord,
} from '../../shared/self-development'
import {
  FileAuditStore,
  FileSelfUpdateStore,
  MemoryAuditStore,
  MemorySelfUpdateStore,
  newAuditEvent,
  type AuditStore,
  type SelfUpdateStore,
} from './stores'
import { MemoryPromotionProvider, type PromotionInput, type PromotionProvider } from './promotion'

export type SelfDevelopmentInput = {
  taskId: string
  repository: string
  branch: string
  baselineCommit: string
  candidateCommit: string
  changedFiles: string[]
  prompt: string
  healthUrl?: string
  environment?: string
}

export class SelfDevelopmentService {
  constructor(
    private readonly store: SelfUpdateStore = new MemorySelfUpdateStore(),
    private readonly audit: AuditStore = new MemoryAuditStore(),
    private readonly provider: PromotionProvider = new MemoryPromotionProvider(),
  ) {}

  async propose(input: SelfDevelopmentInput, actor = 'user') {
    if (!/^[0-9a-f]{7,64}$/i.test(input.baselineCommit))
      throw new Error('A verified baseline commit is required.')
    if (!/^[0-9a-f]{7,64}$/i.test(input.candidateCommit))
      throw new Error('A verified candidate commit is required.')
    if (input.healthUrl && !isSafeHealthUrl(input.healthUrl))
      throw new Error('Promotion health URLs must use HTTPS or localhost.')
    const changeClass = classifyChange(input.changedFiles, input.prompt)
    const policy = approvalPolicy(changeClass)
    const now = new Date().toISOString()
    const record = selfUpdateRecordSchema.parse({
      id: randomUUID(),
      taskId: input.taskId,
      targetRepository: input.repository,
      targetBranch: input.branch,
      baselineCommit: input.baselineCommit,
      candidateCommit: input.candidateCommit,
      changedFiles: input.changedFiles,
      prompt: input.prompt,
      changeClass,
      state: 'awaiting-approval',
      approval: { required: true, approved: false },
      promotion: { provider: this.provider.name },
      healthUrl: input.healthUrl,
      createdAt: now,
      updatedAt: now,
    })
    const created = await this.store.create(record)
    await this.audit.append(
      newAuditEvent(created.id, 'proposed', actor, {
        taskId: created.taskId,
        changeClass: created.changeClass,
        requiresSecurityReview: policy.requiresSecurityReview,
      }),
    )
    return created
  }

  async list() {
    return this.store.list()
  }

  async get(id: string) {
    return this.store.get(id)
  }

  async auditTrail(id: string) {
    await this.store.get(id)
    return this.audit.forUpdate(id)
  }

  async approve(id: string, actor = 'user') {
    const record = await this.store.get(id)
    if (record.state !== 'awaiting-approval')
      throw new Error('Only a proposed self-update can be approved.')
    const next = await this.store.update(id, {
      state: 'approved',
      approval: { ...record.approval, approved: true, actor, approvedAt: new Date().toISOString() },
    })
    await this.audit.append(newAuditEvent(id, 'approved', actor, { changeClass: record.changeClass }))
    return next
  }

  async promote(id: string, actor = 'user') {
    const record = await this.store.get(id)
    if (record.state !== 'approved' || !record.approval.approved)
      throw new Error('Explicit approval is required before promotion.')
    const input: PromotionInput = {
      repository: record.targetRepository,
      branch: record.targetBranch,
      candidateCommit: record.candidateCommit,
      baselineCommit: record.baselineCommit,
      environment: 'production',
      operation: 'promote',
    }
    try {
      const receipt = await this.provider.promote(input)
      const next = await this.store.update(id, {
        state: 'verifying',
        promotion: {
          ...record.promotion,
          operationId: receipt.operationId,
          runUrl: receipt.runUrl,
          requestedAt: receipt.acceptedAt,
        },
      })
      await this.audit.append(
        newAuditEvent(id, 'promotion-requested', actor, {
          operationId: receipt.operationId,
          provider: this.provider.name,
        }),
      )
      return next
    } catch (error) {
      const next = await this.store.update(id, {
        state: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
      await this.audit.append(newAuditEvent(id, 'failed', actor, { reason: next.error ?? 'unknown' }))
      return next
    }
  }

  async verify(id: string, actor = 'system') {
    const record = await this.store.get(id)
    if (record.state !== 'verifying')
      throw new Error('Only a promotion awaiting health verification can be verified.')
    if (!record.healthUrl) throw new Error('A health URL is required before production verification.')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const response = await fetch(record.healthUrl, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Health check returned HTTP ${response.status}.`)
      const next = await this.store.update(id, {
        state: 'deployed',
        promotion: { ...record.promotion, verifiedAt: new Date().toISOString() },
      })
      await this.audit.append(newAuditEvent(id, 'verified', actor, { healthUrl: record.healthUrl }))
      return next
    } catch (error) {
      const next = await this.store.update(id, {
        state: 'failed',
        error: error instanceof Error ? error.message : 'Health verification failed.',
      })
      await this.audit.append(newAuditEvent(id, 'failed', actor, { reason: next.error ?? 'unknown' }))
      return next
    } finally {
      clearTimeout(timeout)
    }
  }

  async rollback(id: string, actor = 'user') {
    const record = await this.store.get(id)
    if (!['verifying', 'deployed', 'failed'].includes(record.state))
      throw new Error('This self-update cannot be rolled back in its current state.')
    const receipt = await this.provider.rollback({
      repository: record.targetRepository,
      branch: record.targetBranch,
      candidateCommit: record.baselineCommit,
      baselineCommit: record.candidateCommit,
      environment: 'production',
      operation: 'rollback',
    })
    const next = await this.store.update(id, {
      state: 'rolled-back',
      promotion: {
        ...record.promotion,
        operationId: receipt.operationId,
        runUrl: receipt.runUrl,
        requestedAt: receipt.acceptedAt,
      },
    })
    await this.audit.append(newAuditEvent(id, 'rolled-back', actor, { rollbackCommit: record.baselineCommit }))
    return next
  }

  async cancel(id: string, actor = 'user') {
    const record = await this.store.get(id)
    if (['deployed', 'rolled-back'].includes(record.state))
      throw new Error('A completed self-update cannot be cancelled.')
    const next = await this.store.update(id, { state: 'cancelled' })
    await this.audit.append(newAuditEvent(id, 'cancelled', actor))
    return next
  }
}

export function createFileBackedSelfDevelopment(
  dataPath: string,
  auditPath: string,
  provider: PromotionProvider,
) {
  return new SelfDevelopmentService(
    new FileSelfUpdateStore(dataPath),
    new FileAuditStore(auditPath),
    provider,
  )
}
