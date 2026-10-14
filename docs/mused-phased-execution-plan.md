# Mused — Phased Execution Plan

**Status:** Proposed execution baseline  
**Date:** 2026-10-14  
**Mused repository baseline:** `muntrav/mused`, main commit `874f98e49853a4787687f2a465446161c5ed4b08`  
**Product name:** Mused  
**Primary goal:** Evolve the current Muse Desktop concept into Mused, a reusable agent platform that can run Muse or Codex, expose the experience through a browser-hosted interface, and support controlled chat-driven changes to its own source code.  
**Design requirement:** Preserve the current design and visual identity in full, including the existing logos and artwork.

## 1. Executive summary

The work is divided into three related workstreams. Each workstream has three phases,
for nine phases total.

| Workstream | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| Provider-neutral reusable adapter layer | Define contracts and isolate the current Muse host | Implement the Codex adapter and auth lifecycle | Harden, version, package, and prove provider parity |
| Browser-based hosted interface | Build the authenticated browser shell and remote gateway | Connect live agent sessions and hosted workspaces | Harden hosting, recovery, scaling, and release operations |
| Self-developing coding environment | Build the workspace/task/change pipeline | Add live preview, hot reload, and feedback loops | Add approval-gated self-updates, rollback, and production promotion |

The dependency order is important:

1. The adapter layer becomes the stable application boundary.
2. The browser interface consumes that boundary through a remote gateway.
3. The self-developing environment uses the same adapter, workspace, and gateway contracts to edit and preview the platform itself.

## 2. Verified starting point

The Mused repository baseline is an Electron/React/TypeScript application. Its current
runtime is tightly coupled to the Muse provider/CLI. In this document, “Muse” refers to
that existing provider/CLI, while “Mused” refers to the new product and repository.

- `src/main/cli.ts` discovers the installed `muse` executable, verifies `muse --version`,
  and reconstructs the login-shell environment.
- `src/main/muse-host.ts` launches `muse serve` through `@muse-code/sdk` and owns the
  Muse stdio protocol connection.
- The active host uses Muse-specific operations including `session/start`,
  `session/read`, `session/resume`, `turn/start`, `approval/decide`, and
  `userInput/answer`.
- `src/shared/protocol.ts` defines the renderer-facing `DesktopAPI`, connection status,
  session views, approval objects, questions, and preferences.
- `src/preload/index.ts` exposes that API through a narrow context-isolated Electron
  bridge.
- The current README states that renderer changes reload during development, while
  main-process and preload changes require restarting the development process.
- Authentication currently belongs to the installed CLI. The desktop app does not
  maintain a separate account or credential store.

Codex provides an app-server that can run over stdio and exposes account login methods
including `account/login/start`, `account/login/cancel`, `account/logout`, and the
`account/login/completed` notification. The adapter must use the supported app-server
protocol rather than reading Codex credential files directly.

### Source evidence

- Repo: [muntrav/mused — README](https://github.com/muntrav/mused/blob/874f98e49853a4787687f2a465446161c5ed4b08/README.md)
- Repo: [muntrav/mused — CLI discovery](https://github.com/muntrav/mused/blob/874f98e49853a4787687f2a465446161c5ed4b08/src/main/cli.ts)
- Repo: [muntrav/mused — Muse host](https://github.com/muntrav/mused/blob/874f98e49853a4787687f2a465446161c5ed4b08/src/main/muse-host.ts)
- Repo: [muntrav/mused — shared protocol](https://github.com/muntrav/mused/blob/874f98e49853a4787687f2a465446161c5ed4b08/src/shared/protocol.ts)
- Repo: [muntrav/mused — preload bridge](https://github.com/muntrav/mused/blob/874f98e49853a4787687f2a465446161c5ed4b08/src/preload/index.ts)
- Repo: [openai/codex — app-server account protocol](https://github.com/openai/codex/blob/1b6e0d8145e1fe5b2663d32fbe7ee02f51a10e1c/codex-rs/app-server-protocol/src/protocol/common.rs)
- Repo: [openai/codex — Python login client reference](https://github.com/openai/codex/blob/1b6e0d8145e1fe5b2663d32fbe7ee02f51a10e1c/sdk/python/src/openai_codex/_login.py)

## 3. Architecture principles

### 3.1 Stable boundaries

The renderer, browser client, and self-development workflow must depend on normalized
application contracts rather than provider-specific method names. Provider details stay
behind adapters.

### 3.2 Credential ownership

Codex or Muse owns provider credentials. The platform may request login, report status,
and request logout, but must not copy provider refresh tokens into renderer state,
browser storage, ordinary preferences, logs, Git, or URLs.

### 3.3 Control plane versus workspace plane

The hosted gateway and session supervisor are the control plane. Project workspaces,
dev servers, tests, and agent processes are isolated workspace-plane workloads. A broken
workspace must not be able to take down the gateway or change its authentication policy.

### 3.4 Preview before promotion

Every code change follows:

```text
request → plan → isolated worktree → edit → validate → preview → approval → merge/deploy
```

The running production instance must not directly overwrite its own live executable or
production checkout.

### 3.5 Capability-based portability

Muse and Codex do not expose identical features. The common interface must model the
shared denominator and advertise optional capabilities instead of pretending the
providers are equivalent.

### 3.6 Remote-build discipline

Preview and production builds should run through GitHub Actions and the configured Cloudflare Pages/Workers path where suitable. The VPS is allowed to run persistent workloads that GitHub and Cloudflare cannot provide reliably: authenticated agent sessions, isolated project workspaces, live development servers, HMR, and workspace-scoped checks. It must not become an untracked CI or release-build machine.

The VPS runtime receives verified artifacts or deployment configuration through the repository release path and is isolated from unrelated services. Use a separate service account or container boundary, authenticated WSS or a private Cloudflare Tunnel, per-workspace CPU/memory/time limits, concurrency limits, idle cleanup, disk quotas, redacted logs, and no publicly exposed provider process port.

### 3.7 Mused design and identity preservation

This is a non-negotiable product requirement. Mused must fully maintain the current
design rather than introducing a new visual system during the provider or hosting work.

Preserve unless Travor explicitly approves a separate design change:

- layout, navigation, workspace composition, and information hierarchy;
- typography, font sizing, spacing, borders, shadows, radii, and motion behavior;
- all current themes, theme assets, colors, contrast behavior, and appearance settings;
- existing logos, logo proportions, mascot, illustrations, artwork, icons, and image
  assets without redrawing, replacing, or simplifying them;
- macOS, Windows, and Linux window chrome and platform-specific presentation;
- current menus, buttons, states, empty states, dialogs, and interaction language.

The product name changes to **Mused** in approved surrounding product text, but existing
logo files and artwork remain unchanged. Provider names such as Muse and Codex remain
accurate where they describe the underlying provider.

Every UI phase must include visual regression evidence: representative screenshots or
browser assertions, asset-presence checks, and a review of responsive/desktop states.
Functional changes should be isolated from visual changes so a provider migration cannot
silently become a redesign.

## 4. Target architecture

```text
                         ┌────────────────────────┐
                         │ Electron desktop client│
                         └───────────┬────────────┘
                                     │ Agent API
┌──────────────────────┐              │
│ Browser React client │──HTTPS/WSS───┼──┐
└──────────────────────┘              │  │
                              ┌───────▼──▼────────┐
                              │ Authenticated      │
                              │ remote gateway     │
                              └────────┬───────────┘
                                       │ session/workspace API
                              ┌────────▼───────────┐
                              │ Agent session       │
                              │ supervisor          │
                              └────────┬───────────┘
                                       │ AgentAdapter
                    ┌──────────────────┼──────────────────┐
                    │                                     │
             ┌──────▼──────┐                       ┌──────▼──────┐
             │ MuseAdapter │                       │ CodexAdapter│
             └──────┬──────┘                       └──────┬──────┘
                    │ Muse SDK/stdio                      │ Codex app-server/stdio
                    ▼                                     ▼
             installed Muse CLI                     installed Codex CLI

                              ┌──────────────────────┐
                              │ Workspace supervisor │
                              │ worktree/dev server  │
                              │ checks/preview/revert│
                              └──────────────────────┘
```

## 5. Workstream A — Provider-neutral reusable adapter layer

### Phase A1 — Contract definition and Muse isolation

**Objective:** Create a provider-neutral boundary without changing the visible product
behavior or Mused's existing visual identity.

#### In scope

- Define shared domain types for:
  - provider identity and connection status;
  - authentication status and login attempts;
  - threads/conversations and thread summaries;
  - turns and streaming events;
  - transcript items and output references;
  - approvals, questions, cancellation, and errors;
  - models, reasoning settings, usage, attachments, and capabilities;
  - workspace/project identity.
- Define the `AgentAdapter` and `AuthAdapter` interfaces.
- Define a typed event envelope with sequence/revision information so clients can
  recover after disconnects.
- Extract a generic stdio JSON-RPC transport with:
  - process lifecycle management;
  - request correlation;
  - notification dispatch;
  - bounded message sizes;
  - shutdown and cancellation;
  - stderr handling without credential leakage;
  - protocol errors that preserve machine-readable categories.
- Wrap the existing Muse host behind the new contract.
- Keep a compatibility facade so current renderer calls continue to work during the
  migration.
- Define a capability matrix instead of adding provider conditionals throughout React.

#### Suggested module boundary

```text
src/main/agent/types.ts
src/main/agent/adapter.ts
src/main/agent/auth.ts
src/main/agent/events.ts
src/main/agent/jsonrpc-stdio.ts
src/main/agent/muse-adapter.ts
src/main/agent/manager.ts
```

#### Deliverables

- Versioned TypeScript interfaces and Zod schemas.
- Muse adapter passing the existing session, approval, question, and streaming flows.
- Contract test fixtures independent of either provider.
- Migration notes describing each current `DesktopAPI` method's new owner.
- Design-preservation checklist confirming that the current logos, artwork, themes,
  layout, and window presentation remain intact.
- Error taxonomy covering unavailable provider, authentication required, invalid
  request, permission denied, workspace failure, protocol mismatch, and transient
  transport failure.

#### Verification

- Typecheck with no provider-specific types leaking into shared UI contracts.
- Existing unit, integration, and end-to-end tests remain green.
- Fake-adapter tests cover connect, reconnect, list, open, start turn, stream events,
  cancellation, approval, question, and logout.
- A forced transport disconnect proves that the adapter emits a recoverable error and
  does not silently duplicate a mutating command.
- Secret-scan test confirms that auth payloads and subprocess environment output are not
  written to logs.
- Representative visual checks show no unapproved change, and existing logo/artwork
  assets remain present and unmodified.

#### Exit gate

Phase A1 is complete when Mused behaves as before while the renderer depends on the
provider-neutral interface, the adapter can be replaced by a fake without changing UI
code, and the current visual identity is preserved.

#### Risks and decisions

- **Decision:** whether to rename `window.muse` to `window.agent` immediately or keep a
  temporary compatibility alias.
- **Risk:** over-generalizing before Codex behavior is mapped. Keep shared contracts
  small and capability-driven.
- **Risk:** losing Muse-specific safety behavior during extraction. Preserve workspace
  trust, approval freshness, cancellation, and no-blind-retry rules as explicit tests.

### Phase A2 — Codex adapter and authentication lifecycle

**Objective:** Run Codex through the same application contract and expose supported
login flows without handling tokens in the UI.

#### In scope

- Add Codex executable discovery and validation alongside Muse discovery.
- Launch Codex app-server over stdio with a pinned/validated protocol version.
- Implement the Codex protocol client using generated or manually maintained typed
  schemas derived from the official app-server schema.
- Map Codex concepts into the common model:
  - `thread` to conversation;
  - `turn` to active work;
  - Codex items to transcript items;
  - permission requests to approval cards;
  - user-input requests to questions;
  - turn and item notifications to normalized stream events.
- Implement `account/login/start` for browser login and device-code login.
- Implement `account/login/cancel`, `account/logout`, account status, and login-completed
  notifications.
- Open OAuth URLs only through a validated main-process/system-browser path.
- Keep authentication storage owned by Codex app-server/Codex CLI.
- Add a provider selector and connection status model.
- Keep the current Mused settings, dialogs, themes, logos, artwork, and visual hierarchy;
  add provider controls within the existing design language.

#### Deliberately out of scope

- Reading or importing `~/.codex/auth.json` directly.
- Passing access tokens through the browser client.
- Using unstable internal token-handoff APIs for ordinary desktop login.
- Claiming perfect feature parity before each feature has a verified mapping.

#### Deliverables

- `CodexAdapter` implementing the shared interface.
- Codex protocol version negotiation and compatibility warning.
- Login dialog with browser-login and device-code alternatives.
- Account status panel showing provider, authenticated state, and safe diagnostic text.
- Provider capability matrix used by the UI.
- Isolated fake app-server and protocol fixtures for tests.

#### Verification

- Start Codex app-server with an isolated home/config directory in tests.
- Verify initialization, account status, login-start response parsing, login-cancel,
  logout, and completion notification handling.
- Verify a post-login thread can start, stream, request approval, receive an answer,
  cancel, and resume after reconnect.
- Verify malformed and unsupported protocol responses fail closed with actionable
  compatibility errors.
- Verify that account login does not place tokens in IPC payload logs, browser storage,
  preferences, crash reports, or Git diffs.
- Run visual regression checks for connection/settings flows and confirm that the
  existing logo and artwork assets are used rather than replaced.

#### Exit gate

Phase A2 is complete when a user can select Codex, authenticate through a supported
flow, start and resume a conversation, handle approvals/questions, and return to the
other provider without provider-specific code in the main renderer components or an
unapproved change to Mused's visual identity.

#### Risks and decisions

- **Decision:** which Codex app-server release/schema commit is supported initially.
- **Decision:** whether provider selection is per installation, per workspace, or per
  conversation. Prefer per workspace with an explicit override.
- **Risk:** protocol churn. Pin schemas, expose a warning, and keep a compatibility
  test fixture for every supported release.

### Phase A3 — Reusable packaging, parity, and contract hardening

**Objective:** Turn the adapter core into a stable reusable component suitable for the
desktop client, browser gateway, and future clients.

#### In scope

- Move provider-neutral contracts into a package boundary such as `agent-core`.
- Keep provider implementations separate:

```text
packages/agent-core
packages/agent-transport
packages/agent-muse
packages/agent-codex
```

- Publish or internally version package APIs only after contract stabilization.
- Add adapters for desktop-local and server-managed process ownership.
- Add a reusable design-asset and visual-regression contract for desktop and browser
  clients so the current Mused identity remains consistent across surfaces.
- Add capability negotiation and feature fallback behavior.
- Add telemetry-free diagnostics that expose only safe status and timing metadata.
- Add protocol conformance tests and contract snapshots.
- Add path-filtered CI checks for shared core, Muse adapter, Codex adapter, and clients.
- Document upgrade and rollback procedures for Codex protocol changes.

#### Deliverables

- Versioned reusable package API.
- Adapter compliance test suite that every provider must pass.
- Provider compatibility table with tested CLI/app-server versions and unsupported
  features.
- Reference desktop integration and reference remote-gateway integration.
- Changelog and migration guide.

#### Verification

- Run the same contract suite against fake, Muse, and Codex adapters.
- Test concurrent read-only operations and serialized mutating operations.
- Test reconnect, app-server crash, login expiry, workspace deletion, and protocol
  mismatch.
- Run independent builds for desktop, browser client, and gateway.
- Verify package consumers do not need provider SDK internals.
- Verify desktop and browser clients retain the approved Mused design, logos, artwork,
  and theme assets across provider selection and authentication states.

#### Exit gate

Phase A3 is complete when a new client can consume `agent-core` and either adapter
without importing Electron, React, Muse SDK internals, or Codex credential internals, and
the shared client contract includes enough presentation state to preserve Mused's visual
identity across clients.

## 6. Workstream B — Browser-based hosted interface

### Phase B1 — Authenticated browser shell and remote gateway

**Objective:** Provide a secure browser entry point without yet exposing arbitrary
workspace execution, while carrying Mused's current design into the browser.

#### In scope

- Create a browser React client that consumes the shared normalized agent model.
- Recreate the current Mused visual language in the browser without redesigning it:
  reuse the existing logos, artwork, themes, typography, icons, spacing, and major
  layout patterns.
- Create a server-side remote gateway with:
  - HTTPS termination;
  - authenticated sessions;
  - WebSocket upgrade handling;
  - origin validation;
  - structured errors;
  - request IDs and correlation;
  - connection heartbeats;
  - bounded message and payload sizes;
  - rate limits;
  - audit events that exclude secrets and prompt content by default.
- Add user/session authentication separate from Codex authentication.
- Define the browser-to-gateway contract for:
  - session creation;
  - provider selection;
  - connection status;
  - login URL/device-code presentation;
  - normalized events;
  - disconnect/reconnect and replay.
- Keep the gateway stable even if an agent process crashes.

#### Recommended deployment boundary

```text
public HTTPS/WSS
  → Cloudflare Pages / Access / Worker
  → private Cloudflare Tunnel
  → VPS Mused gateway
  → authenticated session supervisor
  → provider adapter
```

Never expose the Codex app-server port directly to the public internet.

#### Deliverables

- Browser login page and authenticated application shell.
- Conversation list, connection status, provider selector, login dialog, and basic
  transcript view.
- Gateway API and WebSocket protocol specification.
- Local fake-agent mode so browser work can proceed without live provider credentials.
- Environment examples for preview, staging, and production without secrets.
- Visual baseline screenshots and asset checks for the browser shell.

#### Verification

- Browser can authenticate and reconnect after a network interruption.
- Unauthenticated requests cannot access session data or WebSocket channels.
- A user cannot subscribe to another user's session ID.
- Invalid origins, oversized messages, expired sessions, and replayed request IDs are
  rejected.
- Gateway remains responsive when a fake agent hangs or exits.
- Browser screenshots and interaction checks confirm that Mused's current design and
  logos are preserved across login, connection, empty, loading, and error states.

#### Exit gate

Phase B1 is complete when a protected browser URL can load the Mused shell, establish an
authenticated WebSocket, show safe connection state, and recover from gateway/agent
disconnects without exposing provider credentials or introducing an unapproved redesign.

#### Risks and decisions

- **Decision:** single-user private access first or multi-user tenancy from the start.
  Prefer single-user private access for the first hosted milestone.
- **Decision:** VPS reverse proxy, Cloudflare Tunnel/Access, or another supported edge
  boundary.
- **Risk:** treating browser authentication and Codex authentication as the same
  identity. Keep them separate and explicitly linked by the server session.

### Phase B2 — Live sessions and hosted workspaces

**Objective:** Make the browser interface useful for real Codex/Muse work while keeping
workspace execution isolated.

#### In scope

- Connect the browser UI to live adapter sessions through the gateway.
- Implement transcript streaming, queued turns, steering, cancellation, approvals,
  questions, model selection, usage summaries, attachments, and history.
- Add workspace registration and selection.
- Support a defined initial workspace strategy:
  - GitHub-backed repository workspaces;
  - explicitly uploaded project archives;
  - a user-authorized local connector; or
  - VPS-hosted isolated workspaces for persistent sessions and live previews.
- Add per-workspace process supervision:
  - one adapter process or session owner;
  - workspace working directory;
  - environment allowlist;
  - CPU/memory/time limits where supported;
  - clean shutdown and stale-process cleanup.
- Persist only the minimum metadata needed for reconnection; keep provider auth owned by
  the provider runtime.
- Keep the hosted browser experience aligned with Mused's current desktop design,
  including the existing logos, artwork, themes, and visual hierarchy.

#### Deliverables

- Functional browser chat with parity for the common adapter capabilities.
- Workspace dashboard showing repository, branch, active agent, and dev-server state.
- Reconnect/replay protocol for missed events.
- Server-side workspace lifecycle service.
- Clear distinction between workspace files, conversation history, and provider account
  data.

#### Verification

- Full browser journey: login → select provider → authenticate provider → select
  workspace → start thread → stream turn → approve/answer → cancel → reconnect.
- Two workspaces cannot read or modify one another's files.
- A terminated workspace process cannot access another user's session.
- Large outputs, binary attachments, and failed turns are bounded and recoverable.
- Live preview and browser client are verified by checking the rendered result rather
  than relying only on a successful server response.
- Visual regression checks confirm that live sessions, approvals, questions, loading
  states, and errors preserve Mused's existing design and logo assets.

#### Exit gate

Phase B2 is complete when a user can perform a complete authenticated coding session
from a browser against an isolated workspace with verified reconnect and failure
behavior, while the browser presentation remains faithful to Mused's current design.

#### Risks and decisions

- **Decision:** whether hosted workspaces are persistent or ephemeral.
- **Decision:** how repositories enter the workspace and where resulting changes are
  pushed.
- **Risk:** a remote agent can access more files or network destinations than intended.
  Use workspace containment, explicit environment policy, and provider approval modes.

### Phase B3 — Hosting hardening and operational release

**Objective:** Make the browser interface dependable as a hosted service rather than a
development demo.

#### In scope

- Harden HTTPS/WSS, session cookies/tokens, CSRF boundaries, origin policy, and secret
  handling.
- Add health/readiness endpoints that do not disclose account or workspace data.
- Add structured operational logs with redaction.
- Add resource quotas, idle session cleanup, concurrency limits, and backpressure.
- Add durable session recovery after gateway restart.
- Add backup/restore for non-secret metadata and explicit retention policies.
- Add deployment pipeline that builds in GitHub Actions, publishes browser artifacts through Cloudflare, and delivers immutable runtime artifacts or configuration to the VPS.
- Add staged rollout and rollback procedure.
- Add security review for:
  - command execution;
  - file access;
  - workspace isolation;
  - OAuth callback/device login;
  - WebSocket authorization;
  - prompt/output retention;
  - package and update supply chain.

#### Deliverables

- Staging and production deployment definitions.
- Protected configuration and secret references.
- Runbook for login failures, agent crashes, stuck workspaces, quota exhaustion,
  rollback, and credential revocation.
- Availability and recovery targets.
- Release checklist with explicit promotion approval.

#### Verification

- Restore a gateway from a clean deployment and reconnect an existing session.
- Simulate provider outage, invalid credentials, expired browser session, app-server
  crash, workspace disk pressure, and WebSocket interruption.
- Run dependency, secret, and container/image scans.
- Verify the public link uses HTTPS and that no direct provider process port is exposed.
- Verify the actual staging URL's login, chat, reconnect, and logout flows.

#### Exit gate

Phase B3 is complete when the hosted interface has a repeatable CI-to-deployment path,
verified staging behavior, documented recovery, and an explicit decision to promote to
production.

## 7. Workstream C — Self-developing coding environment

### Phase C1 — Workspace, task, and change pipeline

**Objective:** Allow a user to request a code change conversationally and produce a
reviewable, isolated change set.

#### In scope

- Add a workspace/task model:
  - repository and commit baseline;
  - branch/worktree identity;
  - task prompt and structured plan;
  - changed files;
  - checks and artifacts;
  - preview status;
  - approval status;
  - merge/revert status.
- Create one isolated worktree per active change task.
- Give the agent explicit tools for:
  - repository discovery;
  - file reads and bounded writes;
  - diff inspection;
  - typecheck/test/build execution through an approved runner;
  - preview status and logs.
- Require the agent to produce a plan before material edits for non-trivial tasks.
- Preserve user prompts, generated plans, diffs, and check results as task records, with
  secrets and sensitive file contents excluded.
- Add task cancellation and cleanup.

#### Deliverables

- “New change” flow from browser or desktop chat.
- Worktree manager with cleanup and stale-task recovery.
- Change-task state machine:

```text
requested → planning → editing → checking → previewing → awaiting approval
                                                     ↘ failed/cancelled
awaiting approval → applied/merged or reverted
```

- Diff viewer and check-result viewer.
- Explicit command/tool approval policy.
- Fake workspace runner for deterministic tests.

#### Verification

- Request a small UI change and verify the resulting diff is isolated from the base
  branch.
- Verify path containment and symlink rejection for file operations.
- Verify the agent cannot write outside the assigned worktree.
- Verify cancellation stops the task and cleans temporary processes.
- Verify failed tests leave a reviewable worktree rather than silently claiming success.

#### Exit gate

Phase C1 is complete when a user can request a change, inspect a plan and diff, see
checks, and apply or discard the change without mutating the running production copy.

#### Risks and decisions

- **Decision:** whether changes are committed automatically on the task branch. Prefer
  automatic commits only after checks pass, with user approval before merge.
- **Decision:** which commands are allowed in the runner and which require approval.
- **Risk:** prompt injection from repository files, logs, or generated content. Treat
  repository instructions as untrusted unless explicitly adopted by the user.

### Phase C2 — Live preview, hot reload, and feedback loop

**Objective:** Let the user see safe changes quickly and continue the conversation based
on the live result.

#### In scope

- Add a per-task preview runner.
- For browser builds, use the normal dev-server/HMR path.
- Keep preview changes focused on requested behavior; do not allow the self-development
  workflow to replace Mused's logos, artwork, themes, or design system implicitly.
- For Electron:
  - allow renderer source changes to HMR;
  - restart main/preload processes through a supervisor;
  - reconnect the UI after restart;
  - preserve task state outside the Electron process.
- Add preview URLs or desktop preview state tied to the task/worktree.
- Stream build output, runtime errors, browser console errors, and test failures into
  the task context with redaction and size limits.
- Let the user respond conversationally:
  - “The button is too small.”
  - “Keep the old behavior on Windows.”
  - “The preview is broken; revert the last change.”
- Add visual verification for distinctive UI changes through an approved browser test
  or screenshot workflow.
- Add preview expiry and process cleanup.

#### Deliverables

- Live preview status panel.
- HMR/restart supervisor.
- Preview log and error ingestion.
- Targeted visual test harness.
- Task-aware browser and desktop reconnect behavior.
- Mused design baseline and asset-integrity checks for every UI preview.

#### Verification

- Change a renderer component and observe the preview update without losing the chat
  task.
- Change main/preload code and verify the controlled restart/reconnect path.
- Introduce a compile error and verify that the task reports it and preserves the
  worktree.
- Introduce a runtime error and verify the preview is marked unhealthy without taking
  down the gateway.
- Compare a before/after screenshot or browser assertion for a representative UI change.
- Confirm that requested functional changes preserve the current Mused design, logos,
  artwork, themes, and visual hierarchy unless a separate design change was approved.

#### Exit gate

Phase C2 is complete when a user can request a UI behavior change, observe a live
preview, provide follow-up feedback, and recover from compile/runtime failures without
losing the task or affecting production, while visual regression checks protect Mused's
current design identity.

#### Risks and decisions

- **Decision:** whether previews run on the VPS, in an isolated container, or through a
  remote CI/preview platform. Prefer GitHub Actions and Cloudflare preview deployments for release builds; use isolated VPS runtime workspaces only where persistent sessions or live feedback require them.
- **Risk:** HMR can conceal restart-only bugs. Every phase must include a clean build and
  fresh-start check.
- **Risk:** browser previews may expose project data. Require authenticated, expiring
  preview URLs and workspace-scoped authorization.

### Phase C3 — Approval-gated self-update and production promotion

**Objective:** Allow the platform to improve its own source while preserving recovery,
review, and human control.

#### In scope

- Add self-targeting workspace configuration for the platform repository.
- Keep the stable gateway/supervisor outside the mutable preview workspace.
- Add automated change classification:
  - renderer-only;
  - main/preload;
  - gateway/auth/security;
  - deployment/configuration;
  - destructive/data-affecting.
- Require stronger approval for higher-risk classes.
- Add release gates:
  - typecheck;
  - unit and integration tests;
  - end-to-end browser tests;
  - Electron startup/packaging checks;
  - security and dependency scans;
  - visual verification for UI changes;
  - Mused logo, artwork, theme, and design-identity checks;
  - live staging verification.
- Create a signed/immutable artifact or commit for promotion.
- Deploy through the configured remote CI/deployment path.
- Perform post-deploy health checks and support rollback to the previous known-good
  artifact.
- Keep a recovery channel that can restart the stable supervisor even if the application
  being edited fails.

#### Approval policy

| Change class | Preview allowed | Auto-apply | Human approval before promotion |
|---|---:|---:|---:|
| Renderer styling or copy | Yes | No by default | Yes |
| Renderer behavior | Yes | No | Yes |
| Main/preload process | Yes, with restart | No | Yes |
| Auth, gateway, permissions | Yes, isolated only | Never | Explicit approval and security review |
| Deployment, DNS, secrets, deletion | Staged only | Never | Explicit separate approval |

#### Deliverables

- Self-development mode with an explicit target repository/workspace.
- Change-risk classifier and approval UI.
- CI-trigger integration and staging result collector.
- Promotion, rollback, and recovery controls.
- Audit trail linking request, plan, commit, checks, preview, approval, deployment, and
  post-deploy verification.
- Operator runbook for a failed self-update.

#### Verification

- Use the system to modify a low-risk button behavior in an isolated branch.
- Confirm the system creates a diff, runs checks, presents a preview, requests approval,
  deploys through CI, and verifies the live result.
- Force a failing promotion and verify automatic rollback or a clearly actionable
  blocked state.
- Test that the self-development task cannot modify gateway credentials, deployment
  secrets, production configuration, or another user's workspace.
- Test recovery when the newly deployed UI or worker cannot start.

#### Exit gate

Phase C3 is complete when the platform can safely modify a low-risk part of its own
source, preview and verify the change, promote it through the normal release path after
approval, and recover to the previous version if the change fails.

#### Risks and decisions

- **Decision:** what categories can ever be automated. Authentication, deployment,
  secrets, data deletion, and access-control changes should remain approval-gated.
- **Decision:** whether self-development is single-user only initially. Prefer yes.
- **Risk:** a self-update can remove the very workflow needed to repair it. Keep the
  gateway, supervisor, deployment controls, and rollback artifact outside the mutable
  application workspace.

## 8. Cross-workstream contracts

### Deployment and runtime boundary

The three workstreams share one operational boundary:

| Workload | Location | Rule |
| --- | --- | --- |
| Source, CI checks, packaging, and release artifacts | GitHub Actions | Build from an exact commit; keep credentials in protected secrets. |
| Browser UI and public preview | Cloudflare Pages | Deploy only verified commits; never fall back to a public localhost API. |
| Edge authentication and routing | Cloudflare Access/Workers or private Tunnel | Do not expose provider ports or provider credentials to the browser. |
| Persistent agent sessions and coding workspaces | Protected VPS | Isolate sessions, cap resources, clean up idle work, and preserve an operator recovery path. |

The VPS is part of the runtime plane, not the source-of-truth or release-build plane. A workspace may execute builds and dev servers when live feedback requires it, but release artifacts must be produced and verified through the GitHub/Cloudflare workflow before being promoted.

### 8.1 Agent API contract

The shared contract should provide stable operations such as:

```ts
interface AgentAdapter {
  readonly provider: ProviderId
  readonly capabilities: CapabilitySet
  connect(): Promise<ConnectionStatus>
  disconnect(): Promise<void>
  auth: AuthAdapter
  listThreads(input?: ListThreadsInput): Promise<Page<ThreadSummary>>
  readThread(id: string): Promise<ThreadView>
  startThread(input: StartThreadInput): Promise<ThreadView>
  startTurn(input: TurnInput): Promise<void>
  cancelTurn(input: CancelTurnInput): Promise<void>
  respondToApproval(input: ApprovalResponse): Promise<void>
  respondToQuestion(input: QuestionResponse): Promise<void>
  subscribe(listener: (event: AgentEvent) => void): Unsubscribe
}
```

Mutating calls should carry an idempotency/request identity and must not be blindly
retried after an unknown acknowledgement state.

### 8.2 Browser protocol contract

The gateway should expose normalized session operations rather than raw arbitrary JSON-RPC
forwarding. Raw provider RPC may be retained for diagnostics only behind a privileged,
non-public path.

Every browser event should include:

- authenticated subject/session identity;
- workspace and agent-session identity;
- monotonic event sequence or recoverable cursor;
- event type and normalized payload;
- safe error category;
- no provider token or secret-bearing diagnostic text.

### 8.3 Workspace contract

Each workspace must have:

- an immutable baseline commit;
- an isolated writable root;
- an owner and access policy;
- a lifecycle state;
- resource limits;
- cleanup policy;
- preview endpoint identity;
- artifact and log retention policy.

### 8.4 Release contract

No change is considered complete merely because the agent edited a file or a build
command returned success. Completion evidence must include:

1. exact commit/worktree;
2. checks run and results;
3. preview or staging URL;
4. verified rendered/runtime behavior;
5. approval record;
6. deployed artifact/commit;
7. post-deploy health result;
8. rollback reference.

## 9. Initial implementation order

The recommended first delivery sequence is:

1. A1: extract the adapter contract and preserve Muse behavior.
2. A2: add Codex app-server and login support.
3. B1: build the private authenticated browser shell against a fake adapter.
4. B2: connect the browser to live Codex sessions and one isolated workspace strategy.
5. C1: implement worktrees, task state, diffs, and checks.
6. C2: add previews and HMR/restart supervision.
7. A3/B3: harden package and hosting boundaries while preserving Mused's visual identity.
8. C3: enable approval-gated self-development and promotion.

This order prevents the self-development system from being built before the provider,
remote-session, and workspace contracts are stable.

## 10. Decisions required before implementation

These decisions materially affect implementation and should be recorded before the
corresponding phase begins:

1. **Provider scope:** Muse plus Codex from day one, or Codex first with Muse retained as
   a compatibility adapter?
2. **Codex version policy:** which app-server release/schema commit is initially supported?
3. **Hosted tenancy:** single-user private deployment or multi-user product?
4. **Workspace source:** GitHub repositories, uploaded projects, local connector, or a
   combination?
5. **Workspace runtime:** remote isolated runner, CI/preview platform, or both?
6. **Credential storage:** which protected store/keyring is available to the runtime?
7. **Preview exposure:** private network, authenticated preview URLs, or both?
8. **Promotion policy:** always human-approved, or allow narrowly defined low-risk
   changes to auto-merge later?
9. **Retention:** how long should conversation metadata, diffs, logs, and previews live?
10. **Operational ownership:** who can revoke sessions, stop workspaces, roll back, and
    recover a failed self-update?

## 11. Overall completion definition

The combined project is complete only when:

- Desktop and browser clients consume the same provider-neutral contracts.
- Mused retains the current design, themes, logos, mascot/artwork, icons, typography,
  spacing, and window presentation across desktop, browser, and preview surfaces.
- Muse and Codex adapters pass the same normalized behavior suite for their supported
  capability sets.
- Codex login works without exposing credentials to either renderer.
- The hosted browser interface is authenticated, isolated, recoverable, and verified at
  its live URL.
- A self-development task can edit an isolated copy, run checks, provide a live preview,
  accept follow-up feedback, and create a reviewable change.
- Production promotion remains approval-gated for security, deployment, data, and access
  changes.
- A failed self-update can be rolled back without depending on the failed application
  version.