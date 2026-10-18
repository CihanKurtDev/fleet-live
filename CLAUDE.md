# CLAUDE.md

@AGENTS.md

## Claude Code

- Rules live in `.claude/rules/` and load on their own; rules with `paths` load when you work on matching files.
- `.claude/ROADMAP.md`, `.claude/MIGRATION_REPORT.md` and `.claude/archive/` are private and gitignored. Never commit them or copy their content into README, PRs, issues, or published artifacts.
- `TODO.md` is an old local learning plan, not a rule source.
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
- `npm run lint` — currently fails on older errors outside recent work; lint the files you change (`npx eslint <file>` in the app folder). A hook runs ESLint on every TypeScript file Claude edits in `apps/web` or `apps/api`. Other hooks block `db:seed` on the dev data (`rules/backend.md`, Dev data) and flag `prefers-color-scheme` in web sources (the header switch sets `data-theme`).
- `npm run verify` — typecheck, tests, lint and build; fails until the old lint errors are fixed.

## Slash commands

- `/verify` — checks for the current change
- `/pr-body` — PR title and body for the current branch
- `/after-merge` — update `main` and remove a merged branch
- `/measure-page <path>` — measure a page in the browser at the standard sizes
