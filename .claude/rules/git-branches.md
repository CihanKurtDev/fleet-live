---
description: Git branches, commits and the flow after a merge
---

# Git

## Branches

- Never create or check out a branch whose name starts with `cursor/` or `claude/` (tool default names). A hook blocks it.
- Use `feat/`, `fix/`, or `docs/` plus a short topic, for example `feat/ux-driver-assignment`.
- Start new work from an up-to-date `main`. Keep unrelated work on separate branches; ask before mixing.

## Commits and PRs

- Commit, push and open PRs only when the user asks. Never commit on `main`, never force-push (a hook blocks both).
- Stage files by name. Private planning files under `.claude/` (gitignored) never go in; `CLAUDE.md`, `AGENTS.md` and `.claude/` setup files only when the task is about them.
- Run the checks that fit the change before committing (`npm test`, `npm run test:web`, `npm run typecheck`, `npm run build -w web`).
- `gh` is logged in (`gh auth status`). Open PRs with `gh pr create`. Merge to `main` only after the user confirms. If `gh` is logged out, hand the user a PR title and body for the compare page (`https://github.com/CihanKurtDev/fleet-live/compare/main...<branch>`).

## After a merge

- PRs are usually squash-merged, so `git branch -d` refuses. Pull `main`, check `git diff --quiet main <branch>`, and only then delete with `-D`.
- To move work that was based on a squash-merged branch, use `git rebase --onto main <old-tip> <branch>`.
