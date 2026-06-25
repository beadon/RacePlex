---
name: work-from-beta
description: >-
  Set the session to work off the BETA branch. Use when the user says "work from
  beta" (or "work off beta", "start from beta"). Fetches everything, prunes, and
  starts a fresh working branch rebased on the latest origin/BETA; for the rest of
  the session all work is committed to that branch and PR'd into BETA when complete.
  A stopgap until branch selection exists on mobile so the user doesn't have to send
  the full setup prompt every time.
---

# Work From Beta

A tiny session-setup skill. When the user says **"work from beta"**, do the setup
below, then reply with the exact ready line — and treat the BETA workflow as the
standing convention for the rest of the session.

## On invocation — do this immediately

1. Fetch and prune:
   ```bash
   git fetch --all --prune --tags
   ```
2. Start a fresh working branch rebased on the latest `origin/BETA` (do **not**
   work directly on `BETA` or `main`):
   ```bash
   git checkout -B claude/<short-task-slug> origin/BETA
   ```
   If you don't have a task yet, use a generic slug like `claude/beta-work` and
   rename later, or branch when the first task arrives — the point is the branch is
   based on the just-fetched `origin/BETA`.
   - If the working tree is dirty, **stop and ask** before resetting — don't discard
     the user's uncommitted work.

3. Reply with **exactly** this line and nothing else:

   ```
   Ready and working from beta branch
   ```

## Standing convention for the rest of the session

Once invoked, this holds for every task until the session ends or the user says
otherwise:

- **Base all work on the latest `origin/BETA`** (re-fetch if a task starts much later).
- **Commit work to the working branch**, never push to `BETA` or `main` directly.
- **When a piece of work is complete, open a PR into `BETA`** (base `BETA`, head the
  working branch). Owner/repo: `TheAngryRaven/DovesDataViewer`. Use the GitHub MCP
  tools (`mcp__github__create_pull_request`) in the remote/web environment, or
  `gh` locally. Do **not** open PRs into `main`.
- Use a new task-specific branch per distinct piece of work, each off the current
  `origin/BETA`.

That's it — this exists so the user can type "work from beta" instead of pasting the
whole branch-setup prompt on mobile.
