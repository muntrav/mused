import { describe, expect, it } from 'vitest'
import { gatewayRequestSchema } from '../../src/gateway/protocol'
import { PreviewManager } from '../../src/main/workspaces/preview-manager'
import { changeTaskSchema } from '../../src/shared/change-task'

describe('Slice 2 hosted contracts', () => {
  it('accepts Codex auth and live preview gateway requests', () => {
    expect(
      gatewayRequestSchema.parse({
        type: 'agent',
        requestId: 'auth-1',
        action: 'login',
        input: { method: 'browser' },
      }).action,
    ).toBe('login')
    expect(
      gatewayRequestSchema.parse({
        type: 'task',
        requestId: 'preview-1',
        action: 'check',
        input: {
          taskId: 'task-1',
          checks: [],
          preview: { command: 'npm', args: ['run', 'web:dev'] },
        },
      }).action,
    ).toBe('check')
  })

  it('allows a gateway-relative preview URL', () => {
    const task = changeTaskSchema.parse({
      id: 'task-1',
      repositoryRoot: '/srv/projects/example',
      worktreePath: '/srv/tasks/task-1/worktree',
      baselineCommit: 'abc',
      prompt: 'Change the button',
      plan: 'Implement and verify',
      state: 'awaiting-approval',
      risk: 'renderer-behavior',
      changedFiles: ['src/App.tsx'],
      checks: [],
      preview: { status: 'ready', url: '/api/tasks/task-1/preview' },
      approval: { required: true, approved: false },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    expect(task.preview.url).toBe('/api/tasks/task-1/preview')
  })

  it('rejects preview commands outside the allowlist', async () => {
    const manager = new PreviewManager()
    await expect(
      manager.start(
        {
          taskId: 'task-1',
          repositoryRoot: '/srv/projects/example',
          worktreePath: '/srv/tasks/task-1/worktree',
          baselineCommit: 'abc',
        },
        { command: 'sh' },
      ),
    ).rejects.toThrow('Preview commands must use npm, pnpm, yarn, or vite.')
  })
})
