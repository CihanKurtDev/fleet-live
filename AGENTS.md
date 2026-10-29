# AGENTS.md

fleet-live — fleet management app (TypeScript monorepo). Vehicles, telemetry, and a React UI; live updates over SSE.

What exists: `.claude/rules/architecture.md` (Implemented). The only plan is `.claude/ROADMAP.md` (local, gitignored — not on GitHub); no other file keeps a roadmap or a list of next steps, the public README and `docs/` included. Do not start CI/CD.

## General

- TypeScript throughout. Prefer simple, maintainable changes.
- Do not add dependencies without explaining why.
- Do not modify unrelated files.
- Preserve the existing architecture unless there is a strong reason to change it.
- No speculative architecture. Build for current requirements.
- Git branches never start with `cursor/` or `claude/`. Use `feat/`, `fix/`, or `docs/` (see `.claude/rules/git-branches.md`).

## Source of truth

- Code is what exists. If README and code disagree, code wins. README and `docs/` describe the running system only, not what comes next.
- `apps/docs/table.md` is the table-component spec, not a backlog. Do not add client-side vehicle-list sorting because `sortRows.ts` exists.
- README mentions alerts as a domain (table, `active_alerts`, filter) and as REST (`GET`/`PATCH /api/alerts` with optional `type`). SPEEDING and OFFLINE rows are live events (8 s over the current sim road-class limit; no report for 15 s after a company pause, or status `OFFLINE`). LOW_FUEL is a state warning: a vehicle under the tank threshold has one open row, and the row closes itself when the tank is above it again (not a ticker event; `fuel_level` changes only by writes). That is not OSM and not a general rule engine. Home `/` is the company shift briefing (`GET /api/briefing`). Deadline tiles open `/fristen` (`GET /api/due`). What comes next is in `.claude/ROADMAP.md`. Do not start CI/CD.

## Workflow

For a non-trivial feature: inspect the relevant code, propose an approach, name affected files, implement the smallest coherent change, run tests, report what changed and what remains unverified.

API tests: `apps/api/src/test/` (`node:test` + SuperTest). After API changes run `npm test`. Web tests: `apps/web/src/test/` (Vitest); after web changes run `npm run test:web`. Conventions: `.claude/rules/testing.md`.

## More context

- Architecture: `.claude/rules/architecture.md`
- API: `.claude/rules/backend.md`
- React: `.claude/rules/frontend.md`, layout: `.claude/rules/layout.md`
- Shared contract: `.claude/rules/shared.md`
- Tests: `.claude/rules/testing.md`
- Legal statements: `.claude/rules/legal.md`
