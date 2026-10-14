import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { ChangeTaskService } from '../../src/main/workspaces/change-task-service'
import { ChangeTaskStore } from '../../src/main/workspaces/change-task-store'
import { WorktreeManager } from '../../src/main/workspaces/worktree-manager'

const execFile = promisify(execFileCallback)
const temporary: string[] = []

afterEach(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function repository() {
  const root = await mkdtemp(join('/tmp', 'mused-workspace-'))
  temporary.push(root)
  await execFile('git', ['init', '-q', root])
  await execFile('git', ['-C', root, 'config', 'user.email', 'test@mused.local'])
  await execFile('git', ['-C', root, 'config', 'user.name', 'Mused Test'])
  await writeFile(join(root, 'button.ts'), 'export const label = "Send"\n')
  await execFile('git', ['-C', root, 'add', 'button.ts'])
  await execFile('git', ['-C', root, 'commit', '-qm', 'baseline'])
  return root
}

describe('isolated change workspaces', () => {
  it('creates an isolated worktree and rejects escaping paths', async () => {
    const root = await repository()
    const taskRoot = await mkdtemp(join('/tmp', 'mused-tasks-'))
    temporary.push(taskRoot)
    const manager = new WorktreeManager(taskRoot)
    const workspace = await manager.create(root, 'task-1')
    expect(await manager.readFile(workspace, 'button.ts')).toContain('Send')
    await manager.writeFile(workspace, 'button.ts', 'export const label = "Build"\n')
    expect(await manager.diff(workspace)).toContain('Build')
    await expect(manager.readFile(workspace, '../outside')).rejects.toThrow('traverse')
    await manager.remove(workspace)
  })

  it('executes only a named check command inside the worktree', async () => {
    const root = await repository()
    const taskRoot = await mkdtemp(join('/tmp', 'mused-tasks-'))
    temporary.push(taskRoot)
    const manager = new WorktreeManager(taskRoot)
    const workspace = await manager.create(root, 'task-2')
    const result = await manager.run(workspace, 'node', [
      '-e',
      'process.stdout.write(process.cwd())',
    ])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe(workspace.worktreePath)
    await expect(manager.run(workspace, '../node')).rejects.toThrow('approved executable')
    await manager.remove(workspace)
  })
})

describe('change task state machine', () => {
  it('requires a plan and approval before applying a change', () => {
    const store = new ChangeTaskStore()
    const task = store.create({ repositoryRoot: '/repo', prompt: 'Change the button behavior.' })
    expect(task.approval.required).toBe(true)
    expect(() => store.approve(task.id)).toThrow('previewed')
    store.transition(task.id, 'planning')
    store.setPlan(task.id, 'Inspect the button and add a focused test.')
    store.transition(task.id, 'editing')
    store.transition(task.id, 'checking')
    store.transition(task.id, 'previewing')
    store.transition(task.id, 'awaiting-approval')
    expect(store.approve(task.id).state).toBe('applied')
  })

  it('creates a worktree, records a plan, runs checks, and reaches approval', async () => {
    const root = await repository()
    const taskRoot = await mkdtemp(join('/tmp', 'mused-tasks-'))
    temporary.push(taskRoot)
    const service = new ChangeTaskService(new ChangeTaskStore(), new WorktreeManager(taskRoot))
    const created = await service.create({ repositoryRoot: root, prompt: 'Inspect the button.' })
    expect(created.worktreePath).toContain(created.id)
    service.plan(created.id, 'Read the button implementation and run a check.')
    const checked = await service.runChecks(created.id, [
      { name: 'Node smoke check', command: 'node', args: ['-e', 'process.exit(0)'] },
    ])
    expect(checked.state).toBe('awaiting-approval')
    expect(checked.checks[0]?.status).toBe('passed')
    await service.cancel(created.id)
  })
})
