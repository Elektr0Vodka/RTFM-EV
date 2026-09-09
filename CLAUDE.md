**For detailed component documentation, see:**

- `./AGENTS.md` (general project information)
- `app/AGENTS.md` - Backend (FastAPI, database, radio connection, packet decryption)
- `frontend/AGENTS.md` - Frontend (React, state management, WebSocket, components)

## Core Rules

- No small talk. Be concise and factual.
- Never assume facts, intent, environment, requirements, or desired outcomes.
- Verify facts before presenting them as true.
- If information is missing, ambiguous, or cannot be verified, ask questions.
- Clearly distinguish between facts, observations, assumptions, and recommendations.
- If uncertain, state the uncertainty explicitly.
- No em dashes. More human.

## Decision Making

- Do not infer requirements that were not explicitly provided.
- Do not invent configuration values, paths, credentials, versions, APIs, or implementation details.
- Request clarification when multiple valid interpretations exist.
- Prefer primary sources, documentation, and direct evidence.
- Validate changes against available documentation and project standards.

## Code Changes

- Make the smallest change necessary to satisfy the stated requirement.
- Preserve existing functionality unless instructed otherwise.
- Do not refactor unrelated code.
- Do not introduce new dependencies without justification.
- Explain any risks, limitations, or side effects.

## Never claim it works without proof

Before writing "fixed", "works", "done", or "deployed":

1. Name at least two independent checks you actually ran, and show their output.
2. If you could not verify something, write "NOT VERIFIED" explicitly. Never present a guess as a fact; mark it as an assumption.
3. Runtime behaviour (UI, live data) must be observed, not reasoned about. Compiling or type-checking is not evidence that a page renders.
4. Confirm the thing you tested is the thing you changed (right branch, right build, right URL).

## Git Rules

- Never create commits unless explicitly instructed.
- Never push to any remote unless explicitly instructed.
- Never create pull requests unless explicitly instructed.
- Do not add yourself as a co-author to commits.
- Do not include AI-generated attribution, signatures, or co-author lines in commits or PR bodies. This is enforced: `.claude/settings.json` blanks the attribution templates and adds a `PreToolUse` hook that denies any git command carrying such a marker. If the hook denies your command, remove the marker; never work around the hook.
- Never force-push without explicit instruction.
- Never rewrite repository history without explicit instruction.
- Ask before destructive git (force-push, history rewrite, branch deletion, `reset --hard`).

## Parallel sessions and worktrees

Several sessions may run against this repo at once, some in git worktrees under `.claude/worktrees/*`, some in the main checkout. HEAD in a checkout you did not create can move while you work.

- Run `git status` and `git worktree list` before operating on a checkout that is not yours.
- Never `reset --hard` in a shared checkout; it can destroy another session's uncommitted work.
- Stash narrowly (`git stash push -- <path>`), never repo-wide, and restore in the same atomic step.

## Communication

- State what is known, what is unknown, what was verified, and what requires user confirmation.
- Ask direct questions when required information is missing.
- Report errors exactly as observed. Do not speculate about root causes without evidence.
- Present diagnostic findings separately from conclusions.
- When proposing fixes, indicate confidence level and supporting evidence.

## Security

- Never expose or commit secrets, credentials, tokens, or private keys.
- Flag security concerns when identified.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues on `Elektr0Vodka/RTFM-EV` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root, created lazily by the skills. See `docs/agents/domain.md`.
