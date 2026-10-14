# Mused Slice 2 implementation

Slice 2 completes the next delivery layer across the three Mused workstreams.

## A2 — Codex provider adapter

The hosted runtime now launches the official Codex CLI app-server through a bounded JSON-RPC-over-stdio transport:

- codex app-server is started server-side only.
- The transport performs the required initialize / initialized handshake.
- thread/*, turn/*, item/*, and account notifications are normalized to the provider-neutral adapter contracts.
- Browser ChatGPT login uses account/login/start and exposes only a login URL/device code to the browser.
- Codex tokens remain owned by the Codex runtime and are never copied into browser storage, Cloudflare settings, Git, or logs.
- Approval and user-input requests remain explicit; Mused never auto-approves a Codex command or file change.
- The existing Muse adapter and UI contract remain available.

## B2 — Live hosted sessions

src/gateway/dev.ts uses Codex by default and supports MUSED_PROVIDER=fake for deterministic development. The gateway provides:

- authenticated HTTP and WebSocket access;
- live streamed thread updates and authentication events;
- configurable workspace roots;
- a private runtime boundary suitable for a Cloudflare Tunnel or other authenticated reverse proxy;
- an explicit unavailable state when Codex is not installed or authenticated.

Required production configuration:

- MUSED_GATEWAY_SECRET — at least 12 characters, supplied through protected runtime storage;
- MUSED_ALLOWED_WORKSPACE_ROOTS — comma-separated absolute workspace roots;
- MUSED_ALLOW_WORKSPACE_EXECUTION=true — explicit opt-in;
- MUSED_CODEX_PATH — optional Codex executable path;
- MUSED_GATEWAY_ORIGIN — exact browser origin;
- NODE_ENV=production — enables secure session cookies.

The Codex app-server remains loopback/stdio-bound. Do not publish its stdio or an unauthenticated gateway port directly to the internet.

## C2 — Isolated preview and HMR loop

Change tasks can run an approved check set, start a dev server inside their isolated Git worktree, and expose it through the authenticated gateway:

1. Create a detached worktree.
2. Record the plan.
3. Run bounded, allowlisted checks.
4. Start an allowlisted preview command with loopback host and an allocated port.
5. Probe the preview before marking it ready.
6. Proxy /api/tasks/{taskId}/preview through the gateway.
7. Review the live preview and diff.
8. Approve or cancel; cancellation stops the process and removes the worktree.

Preview processes are not production services. They have no public listener, use the task worktree as their working directory, and are cleaned up on task cancellation. The browser UI preserves the Mused visual identity while showing live streamed responses and preview links.

## Verification gate

Slice 2 is complete only when:

- typecheck, unit tests, formatting, browser build, Electron build, and remote packaging pass;
- unauthenticated HTTP and WebSocket access is rejected;
- Codex absence reports a controlled unavailable state;
- login URLs/device codes are browser-visible but credentials are not;
- streamed Codex events reach the gateway and browser client;
- preview commands are allowlisted, loopback-bound, health-checked, and proxied only after session authentication;
- the existing Mused desktop design, themes, logos, mascot, artwork, and layout remain unchanged.
