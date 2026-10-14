# Hosted workspace selection

## Why the browser no longer asks for a filesystem path

The hosted renderer shares Mused's desktop pages, but it cannot safely browse the user's local filesystem and should not ask the user to type a server path into window.prompt(). Production coding tools use a named environment or repository selector first; the service resolves that name to a server-side workspace.

- [OpenAI Codex environments](https://help.openai.com/en/articles/11390924) describes selecting a connected repository/environment before working.
- [Cursor projects](https://prod.cursor.com/docs/agent/projects) uses projects/workspaces as the unit of agent context.
- [Cursor Cloud Agents](https://prod.cursor.com/docs/cloud-agent) clones and operates on repositories server-side rather than asking for arbitrary browser paths.

## Mused implementation

The canonical desktop renderer now uses a shared WorkspacePicker in hosted mode. The web adapter exposes listProjects, and the gateway returns only project directories discovered under MUSED_ALLOWED_WORKSPACE_ROOTS. The browser displays the project name and selection metadata, while the gateway continues to enforce the allowed-root boundary before starting a thread or reading files.

The Electron app retains its native folder chooser. Hosted mode has no raw path prompt, no arbitrary path entry, and no browser filesystem dependency.

## Runtime contract

1. Configure one or more server workspace roots with MUSED_ALLOWED_WORKSPACE_ROOTS.
2. Place connected repositories/projects immediately under those roots.
3. The catalog recognizes Git repositories and common project markers (package.json, pyproject.toml, Cargo.toml, go.mod, and composer.json).
4. The user selects a named project before the first message is sent.
5. Mused stores the selected project as a recent project and sends its server path only over the authenticated gateway session.
6. The gateway re-validates every workspace operation against its configured roots.

GitHub repository connect/clone is a separate capability. It should be added behind an authenticated server-side connector and should populate this same catalog; it must never turn the browser picker into an arbitrary path or token-exposure surface.
