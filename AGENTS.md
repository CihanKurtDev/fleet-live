# AGENTS.md

fleet-live — fleet management app (TypeScript monorepo). Vehicles, telemetry, and a React UI; live updates over SSE.

Phases 1–14 are in place (including depot circles on the fleet map, shift-briefing due counts, the Fristen page for HU, UVV, and driver licence dates grouped by kind, and CSV export; deadlines are not inbox alert types). Company registration, e-mail confirmation, password reset, invites, several companies per person, TOTP and OIDC are in place. **Next:** a mid-session 401 returns the UI to `/login`. Do not start CI/CD. Status detail: `.claude/rules/architecture.md`. Engineering plan: `.claude/ROADMAP.md` (local, gitignored — not on GitHub). The public README has a dispatcher-facing roadmap (what users notice), not phase numbers.

## General

- TypeScript throughout. Prefer simple, maintainable changes.
- Do not add dependencies without explaining why.
- Do not modify unrelated files.
- Preserve the existing architecture unless there is a strong reason to change it.
- No speculative architecture. Build for current requirements.
- Git branches never start with `cursor/` or `claude/`. Use `feat/`, `fix/`, or `docs/` (see `.claude/rules/git-branches.md`).

## Source of truth

- Code is what exists. If README and code disagree, code wins. README describes the running system and user-visible upcoming work, not the engineering backlog.
- `apps/docs/table.md` is the table-component spec, not a backlog. Do not add client-side vehicle-list sorting because `sortRows.ts` exists.
- README mentions alerts as a domain (table, `active_alerts`, filter) and as REST (`GET`/`PATCH /api/alerts` with optional `type`). SPEEDING and OFFLINE rows are live events (8 s over the current sim road-class limit; no report for 15 s after a company pause, or status `OFFLINE`). LOW_FUEL is a state warning: a vehicle under the tank threshold has one open row, and the row closes itself when the tank is above it again (not a ticker event; `fuel_level` changes only by writes). That is not OSM and not a general rule engine. Home `/` is the company shift briefing (`GET /api/briefing`). Deadline tiles open `/fristen` (`GET /api/due`). Next engineering item is a mid-session 401 back to `/login`. Do not start CI/CD.

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
