# AGENTS.md

fleet-live — fleet management app (TypeScript monorepo). Vehicles, telemetry, and a React UI; live updates over SSE.

Phases 1–6 are in place (including live LOW_FUEL and OFFLINE). **Next is Phase 7** (shift briefing). Do not start invite, multi-company membership, or CI/CD. Status detail: `.cursor/rules/architecture.mdc`. Engineering plan: `.cursor/ROADMAP.md` (local, gitignored — not on GitHub). The public README has a dispatcher-facing roadmap (what users notice), not phase numbers.

## General

- TypeScript throughout. Prefer simple, maintainable changes.
- Do not add dependencies without explaining why.
- Do not modify unrelated files.
- Preserve the existing architecture unless there is a strong reason to change it.
- No speculative architecture. Build for current requirements.

## Source of truth

- Code is what exists. If README and code disagree, code wins. README describes the running system and user-visible upcoming work, not the engineering backlog.
- `apps/docs/table.md` is the table-component spec, not a backlog. Do not add client-side vehicle-list sorting because `sortRows.ts` exists.
- README mentions alerts as a domain (table, `active_alerts`, filter) and as REST (`GET`/`PATCH /api/alerts` with optional `type`). SPEEDING, LOW_FUEL and OFFLINE rows are live ticker events (8 s over the current sim road-class limit; fuel under 15% while `DRIVING`; no report for 15 s after a company pause, or status `OFFLINE`). That is not OSM and not a general rule engine. Phase 7 is the shift briefing.

## Workflow

For a non-trivial feature: inspect the relevant code, propose an approach, name affected files, implement the smallest coherent change, run tests, report what changed and what remains unverified.

API tests: `apps/api/src/test/` (`node:test` + SuperTest). After API changes run `npm test`. Conventions: `.cursor/rules/testing.mdc`.

## More context

- Architecture: `.cursor/rules/architecture.mdc`
- API: `.cursor/rules/backend.mdc`
- React: `.cursor/rules/frontend.mdc`
- Shared contract: `.cursor/rules/shared.mdc`
- Tests: `.cursor/rules/testing.mdc`
