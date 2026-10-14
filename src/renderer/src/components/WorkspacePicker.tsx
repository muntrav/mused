import { FolderOpen, RefreshCw } from 'lucide-react'
import type { WorkspaceProject } from '../../../shared/protocol'
import { Dialog } from './Primitives'

export function WorkspacePicker({
  projects,
  loading,
  error,
  onClose,
  onRefresh,
  onSelect,
}: {
  projects: WorkspaceProject[]
  loading: boolean
  error: string
  onClose: () => void
  onRefresh: () => void
  onSelect: (project: WorkspaceProject) => void
}) {
  return (
    <Dialog title="Choose a project" onClose={onClose} className="workspace-picker-dialog">
      <div className="workspace-picker">
        <p className="workspace-picker-copy">
          Choose a connected project before starting a conversation. Mused keeps the server path
          private to the workspace runtime.
        </p>
        {loading && <p className="workspace-picker-empty">Loading available projects…</p>}
        {!loading && error && <p className="workspace-picker-error">{error}</p>}
        {!loading && !error && projects.length === 0 && (
          <p className="workspace-picker-empty">
            No connected projects are available yet. Add a project under the hosted workspace root,
            then refresh this list.
          </p>
        )}
        {!loading && !error && projects.length > 0 && (
          <div className="workspace-picker-list" role="listbox" aria-label="Available projects">
            {projects.map((project) => (
              <button
                type="button"
                className="workspace-picker-option"
                key={project.path}
                onClick={() => onSelect(project)}
              >
                <span className="workspace-picker-option-icon" aria-hidden="true">
                  <FolderOpen size={17} />
                </span>
                <span className="workspace-picker-option-copy">
                  <strong>{project.name}</strong>
                  <span>{project.path}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="request-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button secondary" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        </div>
      </div>
    </Dialog>
  )
}
