# Mused self-development runtime

Slice 3 adds an approval-gated promotion plane for changing Mused itself.

## Safety boundary

The stable gateway and supervisor remain outside the mutable task worktree. A task is
proposed from an immutable candidate commit, classified by changed files and prompt,
and stored with a durable audit trail. No task can promote itself merely because an
agent edited files or a local check passed.

```text
request → isolated worktree → checks → preview → candidate commit
       → risk classification → explicit approval → GitHub Actions
       → Cloudflare deployment → health verification
       → deployed or rollback to baseline
```

Every self-update requires explicit approval. Authentication, gateway, deployment,
secret, access-control, and data-affecting changes are classified as high risk and
remain security-review gated. The browser never receives the GitHub token or provider
credentials.

## Runtime configuration

The VPS gateway may use these protected environment values:

```text
MUSED_GITHUB_TOKEN          # protected token with the minimum workflow-dispatch scope
MUSED_GITHUB_OWNER=muntrav
MUSED_GITHUB_REPO=mused
MUSED_GITHUB_WORKFLOW=self-update.yml
MUSED_GITHUB_URL=https://github.com/muntrav/mused
MUSED_SELF_UPDATE_STORE=.mused/self-updates.json
MUSED_SELF_UPDATE_AUDIT=.mused/self-update-audit.json
```

Do not put any of these values in browser configuration, logs, Git, URLs, or task
prompts. If the GitHub token is absent, the gateway intentionally uses an unconfigured
promotion provider and promotion fails closed.

## Promotion workflow

1. The coding task produces a reviewable diff and candidate commit.
2. The gateway creates a self-update record and classifies its risk.
3. The operator reviews the diff, checks, preview, and audit record.
4. The operator approves the self-update, then explicitly requests promotion.
5. The gateway dispatches `.github/workflows/self-update.yml` with immutable commit and
   baseline inputs.
6. GitHub Actions runs formatting, tests, browser build, and Electron packaging on the
   exact commit before deployment.
7. Cloudflare Pages receives the verified build only when its protected configuration
   is present.
8. The gateway verifies the configured HTTPS health URL. Failed verification leaves the
   record failed and exposes rollback to the known-good baseline.

## Recovery

The rollback action dispatches the same workflow using the recorded baseline commit.
The audit record links proposal, approval, dispatch, health verification, and rollback.
The stable gateway remains available even when the promoted application is unhealthy,
so recovery does not depend on the failed application version.

The current Mused visual identity remains protected throughout this flow: existing
layouts, themes, logos, mascot/artwork, icons, typography, and window presentation are
not changed by the self-development mechanism unless a separate approved design change
is explicitly requested.
