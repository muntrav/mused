import { describe, expect, it } from 'vitest'
import { gatewayRequestSchema } from '../../src/gateway/protocol'
import { MemoryPromotionProvider } from '../../src/main/self-development/promotion'
import { SelfDevelopmentService } from '../../src/main/self-development/service'
import { MemoryAuditStore, MemorySelfUpdateStore } from '../../src/main/self-development/stores'
import { classifyChange } from '../../src/shared/self-development'

describe('Slice 3 self-development contracts', () => {
  it('classifies sensitive changes and exposes the approval-gated gateway protocol', () => {
    expect(classifyChange(['src/gateway/server.ts'], 'change authentication')).toBe(
      'gateway-auth-security',
    )
    const request = gatewayRequestSchema.parse({
      type: 'self-update',
      requestId: 'update-1',
      action: 'promote',
      input: { updateId: 'update-1' },
    })
    expect(request).toMatchObject({ type: 'self-update', action: 'promote' })
  })

  it('requires approval, records promotion, and supports rollback', async () => {
    const provider = new MemoryPromotionProvider()
    const service = new SelfDevelopmentService(
      new MemorySelfUpdateStore(),
      new MemoryAuditStore(),
      provider,
    )
    const proposed = await service.propose({
      taskId: 'task-1',
      repository: 'muntrav/mused',
      branch: 'main',
      baselineCommit: 'abcdef1',
      candidateCommit: '1234567',
      changedFiles: ['src/renderer/src/App.tsx'],
      prompt: 'Change the button behavior',
      healthUrl: 'https://mused.example/health',
    })
    expect(proposed.state).toBe('awaiting-approval')
    await expect(service.promote(proposed.id)).rejects.toThrow('Explicit approval')
    expect((await service.approve(proposed.id)).state).toBe('approved')
    expect((await service.promote(proposed.id)).state).toBe('verifying')
    expect(provider.calls[0]?.operation).toBe('promote')
    expect((await service.rollback(proposed.id)).state).toBe('rolled-back')
    expect(provider.calls[1]?.operation).toBe('rollback')
    expect((await service.auditTrail(proposed.id)).length).toBe(4)
  })
})
