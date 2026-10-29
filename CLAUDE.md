# CLAUDE.md

@AGENTS.md

## Claude Code

- Rules live in `.claude/rules/` and load on their own; rules with `paths` load when you work on matching files.
- `.claude/ROADMAP.md` is the only plan: what comes next, in which order, when a step is done. Remove finished items there instead of ticking them; do not start a second list elsewhere. It and `.claude/archive/` (old reports and plans, no longer planning) are private and gitignored. Never commit them or copy their content into README, PRs, issues, or published artifacts.
- Where a rule and the code disagree, the code wins (AGENTS.md). Check the code before relying on a rule, and fix the rule in the same change.

## Working with the user

- The user writes German; answer in German. Copy in the app is German, code and commit messages are English.
- Ask before work that changes direction or scope. Visual changes start as a design on the canvas artifact; build only the design the user picks.
- Commit, push and PRs only when asked (see `rules/git-branches.md`). End with what changed, what was checked, and what was not checked.
- In the browser, test as the demo dispatcher and put changed settings back afterwards.

## Commands

- `npm run dev` — API (port 3000) and web (Vite, port 5173)
- `npm test` — API tests (`node:test` + SuperTest)
- `npm run test:web` — web tests (Vitest)
- `npm run typecheck`, `npm run build -w web`
- `npm run lint` — passes (0 errors, 2 warnings in `FleetMap.tsx`); lint the files you change (`npx eslint <file>` in the app folder). A hook runs ESLint on every TypeScript file Claude edits in `apps/web` or `apps/api`. Other hooks block `db:seed` on the dev data (`rules/backend.md`, Dev data) and flag `prefers-color-scheme` in web sources (the header switch sets `data-theme`).
- `npm run verify` — typecheck, tests, lint and build.

## Slash commands

- `/verify` — checks for the current change
- `/pr-body` — PR title and body for the current branch
- `/after-merge` — update `main` and remove a merged branch
- `/measure-page <path>` — measure a page in the browser at the standard sizes
