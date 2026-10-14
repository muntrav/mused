import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { ProjectFile, WorkspaceProject } from '../shared/protocol'

const ignoredProjectDirectories = new Set(['.git', 'node_modules', '.DS_Store'])
const projectMarkers = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'composer.json']

async function looksLikeProject(path: string) {
  try {
    const git = await stat(join(path, '.git'))
    if (git.isDirectory() || git.isFile()) return true
  } catch {
    // Continue with language/package markers.
  }
  for (const marker of projectMarkers) {
    try {
      if ((await stat(join(path, marker))).isFile()) return true
    } catch {
      // Try the next marker.
    }
  }
  return false
}

export async function listAvailableProjects(roots: string[]): Promise<WorkspaceProject[]> {
  const projects = new Map<string, WorkspaceProject>()
  for (const configuredRoot of roots) {
    try {
      const root = await realpath(configuredRoot)
      if (!(await stat(root)).isDirectory()) continue
      if (await looksLikeProject(root))
        projects.set(root, {
          path: root,
          name: root.split(/[\\/]/).filter(Boolean).at(-1) || root,
        })
      const entries = await readdir(root, { withFileTypes: true })
      for (const entry of entries) {
        if (
          !entry.isDirectory() ||
          entry.isSymbolicLink() ||
          ignoredProjectDirectories.has(entry.name)
        )
          continue
        const project = join(root, entry.name)
        if (await looksLikeProject(project))
          projects.set(project, { path: project, name: entry.name })
      }
    } catch {
      // A stale or inaccessible configured root is omitted from the catalog.
    }
  }
  return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function resolveProjectPath(project: string, path: string) {
  const root = await realpath(project)
  const target = await realpath(resolve(root, path))
  const fromRoot = relative(root, target)
  if (fromRoot === '..' || /^\.\.[/\\]/.test(fromRoot) || isAbsolute(fromRoot))
    throw new Error('This path is outside the selected project.')
  return { root, target }
}

export async function listProjectFiles(project: string, directory: string): Promise<ProjectFile[]> {
  const { root, target } = await resolveProjectPath(project, directory)
  const entries = await readdir(target, { withFileTypes: true })
  return entries
    .filter(
      (entry) =>
        !['.git', 'node_modules', '.DS_Store'].includes(entry.name) && !entry.isSymbolicLink(),
    )
    .map((entry) => ({
      name: entry.name,
      path: relative(root, join(target, entry.name)).replaceAll('\\', '/'),
      directory: entry.isDirectory(),
    }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
}

export async function readProjectFile(project: string, path: string) {
  const { target } = await resolveProjectPath(project, path)
  const info = await stat(target)
  if (!info.isFile()) throw new Error('Choose a file to preview.')
  if (info.size > 512 * 1024)
    throw new Error('This file is larger than the 512 KB preview limit. Open it in your editor.')
  const content = await readFile(target)
  if (content.includes(0)) throw new Error('This is a binary file. Open it from Finder to view it.')
  return content.toString('utf8')
}
