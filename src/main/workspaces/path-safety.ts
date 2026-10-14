import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

export const MAX_WORKSPACE_FILE_BYTES = 512 * 1024

export class WorkspaceSecurityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceSecurityError'
  }
}

export function assertRelativePath(path: string) {
  if (!path || isAbsolute(path))
    throw new WorkspaceSecurityError('Workspace paths must be relative.')
  const normalized = path.replaceAll('\\', '/')
  if (normalized.split('/').includes('..'))
    throw new WorkspaceSecurityError('Workspace paths cannot traverse outside the workspace.')
  return normalized
}

export function isInside(root: string, target: string) {
  const comparison = relative(root, target)
  return comparison === '' || (!comparison.startsWith('..') && !isAbsolute(comparison))
}

export async function resolveWorkspacePath(root: string, requested: string, allowMissing = false) {
  const safe = assertRelativePath(requested)
  const canonicalRoot = await realpath(root)
  const candidate = resolve(canonicalRoot, safe)
  if (!isInside(canonicalRoot, candidate))
    throw new WorkspaceSecurityError('Path escapes the workspace.')
  try {
    const canonical = await realpath(candidate)
    if (!isInside(canonicalRoot, canonical))
      throw new WorkspaceSecurityError('Path escapes the workspace.')
    return canonical
  } catch (error) {
    if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = await realpath(resolve(candidate, '..'))
    if (!isInside(canonicalRoot, parent))
      throw new WorkspaceSecurityError('Path escapes the workspace.')
    return candidate
  }
}

export async function assertRegularTextFile(path: string) {
  const info = await lstat(path)
  if (!info.isFile()) throw new WorkspaceSecurityError('Only regular files can be read or written.')
  if (info.size > MAX_WORKSPACE_FILE_BYTES)
    throw new WorkspaceSecurityError('Workspace file exceeds the 512 KB task limit.')
}
