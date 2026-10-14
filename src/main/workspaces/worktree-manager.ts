import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  assertRegularTextFile,
  MAX_WORKSPACE_FILE_BYTES,
  resolveWorkspacePath,
  WorkspaceSecurityError,
} from './path-safety'

const execFile = promisify(execFileCallback)
const taskIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}$/

export type WorkspaceDescriptor = {
  taskId: string
  repositoryRoot: string
  worktreePath: string
  baselineCommit: string
}

export type WorkspaceCommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export class WorktreeManager {
  constructor(private readonly tasksRoot = join(homedir(), '.mused', 'change-tasks')) {}

  async create(
    repositoryRoot: string,
    taskId: string,
    baseRef = 'HEAD',
  ): Promise<WorkspaceDescriptor> {
    this.assertTaskId(taskId)
    const repository = resolve(repositoryRoot)
    const repositoryInfo = await stat(repository)
    if (!repositoryInfo.isDirectory())
      throw new WorkspaceSecurityError('Repository root must be a directory.')
    const { stdout: gitRoot } = await execFile('git', ['rev-parse', '--show-toplevel'], {
      cwd: repository,
    })
    const canonicalRoot = resolve(gitRoot.trim())
    const taskRoot = join(resolve(this.tasksRoot), taskId)
    const worktreePath = join(taskRoot, 'worktree')
    await mkdir(resolve(this.tasksRoot), { recursive: true })
    try {
      await stat(worktreePath)
      throw new WorkspaceSecurityError('A workspace already exists for this task.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await mkdir(taskRoot, { recursive: true })
    await execFile('git', ['worktree', 'add', '--detach', worktreePath, baseRef], {
      cwd: canonicalRoot,
      maxBuffer: 1024 * 1024,
    })
    const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktreePath })
    return { taskId, repositoryRoot: canonicalRoot, worktreePath, baselineCommit: stdout.trim() }
  }

  private assertTaskId(taskId: string) {
    if (!taskIdPattern.test(taskId))
      throw new WorkspaceSecurityError('Invalid change-task identifier.')
  }

  async readFile(workspace: WorkspaceDescriptor, path: string) {
    const target = await resolveWorkspacePath(workspace.worktreePath, path)
    await assertRegularTextFile(target)
    const content = await readFile(target)
    if (content.includes('\u0000'))
      throw new WorkspaceSecurityError('Binary workspace files cannot be read as text.')
    return content.toString('utf8')
  }

  async writeFile(workspace: WorkspaceDescriptor, path: string, content: string) {
    if (Buffer.byteLength(content, 'utf8') > MAX_WORKSPACE_FILE_BYTES)
      throw new WorkspaceSecurityError('Workspace file exceeds the 512 KB task limit.')
    const target = await resolveWorkspacePath(workspace.worktreePath, path, true)
    await writeFile(target, content, { encoding: 'utf8', flag: 'wx' }).catch(
      async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
        await assertRegularTextFile(target)
        await writeFile(target, content, { encoding: 'utf8' })
      },
    )
  }

  async diff(workspace: WorkspaceDescriptor) {
    const { stdout } = await execFile('git', ['diff', '--no-ext-diff', '--binary', '--', '.'], {
      cwd: workspace.worktreePath,
      maxBuffer: 4 * 1024 * 1024,
    })
    return stdout
  }

  async changedFiles(workspace: WorkspaceDescriptor) {
    const { stdout } = await execFile('git', ['diff', '--name-only', '-z', '--', '.'], {
      cwd: workspace.worktreePath,
      maxBuffer: 1024 * 1024,
    })
    return stdout.split('\u0000').filter(Boolean)
  }

  async run(
    workspace: WorkspaceDescriptor,
    command: string,
    args: string[] = [],
    timeout = 120000,
  ) {
    if (!command || command.includes('/') || command.includes('\\'))
      throw new WorkspaceSecurityError('Checks must use an approved executable name.')
    try {
      const result = await execFile(command, args, {
        cwd: workspace.worktreePath,
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: workspace.worktreePath,
          XDG_CONFIG_HOME: join(workspace.worktreePath, '.config'),
          npm_config_cache: join(workspace.worktreePath, '.npm-cache'),
          CI: '1',
        },
      })
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        stdout?: string
        stderr?: string
        code?: number | string
      }
      return {
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? failure.message,
        exitCode: typeof failure.code === 'number' ? failure.code : 1,
      }
    }
  }

  async remove(workspace: WorkspaceDescriptor) {
    await execFile('git', ['worktree', 'remove', '--force', workspace.worktreePath], {
      cwd: workspace.repositoryRoot,
      maxBuffer: 1024 * 1024,
    }).catch(() => undefined)
    await rm(join(resolve(this.tasksRoot), workspace.taskId), { recursive: true, force: true })
  }
}
