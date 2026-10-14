# Slice 4 — Desktop/Web UI convergence

## Goal

The hosted Mused interface now mounts the same renderer used by the Electron desktop app. The web client is an adapter boundary, not a second visual implementation.

## Delivered

- The original renderer App, components, styles, tokens, layout, navigation, transcript, composer, projects, files, docs, inspector, settings, and assets are shared by Electron and the browser.
- A WebDesktopAPI implements the renderer's existing DesktopAPI contract over the authenticated Mused gateway.
- Gateway workspace operations expose read-only project browsing, Git status, and Git diff with the same path/root safety rules as the desktop implementation.
- Gateway agent operations cover history, sessions, streaming events, approvals, questions, model selection, rename, compaction, output reading, and cancellation.
- Web-only limitations are explicit: native window controls, terminal/Finder integration, and desktop voice transcription remain desktop capabilities.
- The hosted access/setup pages remain separate utility routes; the actual workspace uses the desktop renderer.

## Design-preservation contract

This slice reuses the canonical renderer rather than reproducing it. No web-only layout or visual token replacement is allowed for workspace pages. Changes to the shared renderer must be verified in both Electron and browser builds. Logos, artwork, typography, spacing, themes, navigation, empty states, transcript structure, composer behavior, and inspector surfaces remain governed by the existing renderer CSS and assets.

## Runtime boundary

~~~text
Electron renderer — DesktopAPI —> preload/main —> Muse or Codex
Browser renderer  — DesktopAPI —> WebDesktopAPI —> authenticated WSS/HTTP gateway
~~~

Browser credentials remain in the gateway session cookie. Codex credentials and workspace access stay server-side.

## Verification gate

1. npm run typecheck
2. npm test
3. npm run format:check
4. npm run web:build
5. npm run build
6. Browser smoke checks confirm the original workspace shell, sidebar, conversation page, composer, Projects, Files, Docs, Settings, and logo asset.
7. Electron smoke checks confirm the same renderer still mounts and window.muse remains the desktop preload API.
8. Compare representative desktop and browser screenshots; differences must be platform chrome or explicitly documented web-only capability states.

## Rollback

Revert the Slice 4 commit or deploy the previous verified Pages/Worker build. The Electron renderer remains the canonical source, so no separate hosted UI migration is required.
