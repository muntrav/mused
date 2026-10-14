import type { ChangeRisk } from '../../shared/change-task'
import { ChangeTaskStore } from './change-task-store'
import { WorktreeManager, type WorkspaceDescriptor } from './worktree-manager'

export type ApprovedCheck = { name: string; command: string; args?: string[]; timeout?: number }

export class ChangeTaskService {
  private readonly workspaces = new Map<string, WorkspaceDescriptor>()

  constructor(
    readonly store = new ChangeTaskStore(),
    private readonly worktreeManager = new WorktreeManager(),
  ) {}

  async create(input: {
    repositoryRoot: string
    prompt: string
    risk?: ChangeRisk
    baseRef?: string
  }) {
    const task = this.store.create(input)
    try {
      const workspace = await this.worktreeManager.create(
        input.repositoryRoot,
        task.id,
        input.baseRef,
      )
      this.workspaces.set(task.id, workspace)
      return this.store.update(task.id, {
        worktreePath: workspace.worktreePath,
        baselineCommit: workspace.baselineCommit,
      })
    } catch (error) {
      return this.store.transition(task.id, 'failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  plan(taskId: string, plan: string) {
    const task = this.store.get(taskId)
    if (task.state === 'requested') this.store.transition(taskId, 'planning')
    this.store.setPlan(taskId, plan)
    return this.store.transition(taskId, 'editing')
  }

  async runChecks(taskId: string, checks: ApprovedCheck[]) {
    const task = this.store.get(taskId)
    if (task.state !== 'editing')
      throw new Error('A task must have an editing plan before checks run.')
    const workspace = this.requireWorkspace(taskId)
    this.store.transition(taskId, 'checking')
    const results = []
    for (const check of checks) {
      this.store.update(taskId, {
        checks: [
          ...results,
          {
            name: check.name,
            command: [check.command, ...(check.args ?? [])].join(' '),
            status: 'running',
          },
        ],
      })
      const result = await this.worktreeManager.run(
        workspace,
        check.command,
        check.args,
        check.timeout,
      )
      results.push({
        name: check.name,
        command: [check.command, ...(check.args ?? [])].join(' '),
        status: result.exitCode === 0 ? ('passed' as const) : ('failed' as const),
        output: `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.slice(0, 200000),
        exitCode: result.exitCode,
      })
      this.store.update(taskId, { checks: [...results] })
      if (result.exitCode !== 0)
        return this.store.transition(taskId, 'failed', { error: `${check.name} failed.` })
    }
    const changedFiles = await this.worktreeManager.changedFiles(workspace)
    this.store.update(taskId, { changedFiles })
    this.store.transition(taskId, 'previewing', {
      preview: { status: 'not-started', message: 'Live preview is provided by Phase C2.' },
    })
    return this.store.transition(taskId, 'awaiting-approval')
  }

  async diff(taskId: string) {
    return this.worktreeManager.diff(this.requireWorkspace(taskId))
  }

  approve(taskId: string) {
    return this.store.approve(taskId)
  }

  async cancel(taskId: string) {
    const task = this.store.get(taskId)
    if (!['applied', 'reverted', 'failed', 'cancelled'].includes(task.state))
      this.store.transition(taskId, 'cancelled')
    const workspace = this.workspaces.get(taskId)
    if (workspace) {
      await this.worktreeManager.remove(workspace)
      this.workspaces.delete(taskId)
    }
    return this.store.get(taskId)
  }

  workspace(taskId: string) {
    return this.workspaces.get(taskId)
  }

  private requireWorkspace(taskId: string) {
    const workspace = this.workspaces.get(taskId)
    if (!workspace) throw new Error('This change task does not have an active worktree.')
    return workspace
  }
}
