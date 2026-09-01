# AGENTS.md

fleet-live — fleet management app (TypeScript monorepo). Vehicles, telemetry, and a React UI; live updates over SSE.

Phase 4 (login and company isolation) is in place. Drivers, warning inbox and the live speed indicator are in place. Status detail: `.cursor/rules/architecture.mdc`.

## General

- TypeScript throughout. Prefer simple, maintainable changes.
- Do not add dependencies without explaining why.
- Do not modify unrelated files.
- Preserve the existing architecture unless there is a strong reason to change it.
- No speculative architecture. Build for current requirements.

## Source of truth

- Code is what exists. If README and code disagree, code wins. README Current Status / Roadmap should describe the running system.
- `apps/docs/table.md` is the table-component spec, not a backlog. Do not add client-side vehicle-list sorting because `sortRows.ts` exists.
- README mentions alerts as a domain (table, `active_alerts`, filter) and as REST (`GET`/`PATCH /api/alerts`). SPEEDING rows are live ticker events (8 s over 90); LOW_FUEL/OFFLINE remain seeded. That is not OSM and not a general rule engine.

## Workflow

For a non-trivial feature: inspect the relevant code, propose an approach, name affected files, implement the smallest coherent change, run tests, report what changed and what remains unverified.

API tests: `apps/api/src/test/` (`node:test` + SuperTest). After API changes run `npm test`. Conventions: `.cursor/rules/testing.mdc`.

## More context

- Architecture: `.cursor/rules/architecture.mdc`
- API: `.cursor/rules/backend.mdc`
- React: `.cursor/rules/frontend.mdc`
- Shared contract: `.cursor/rules/shared.mdc`
- Tests: `.cursor/rules/testing.mdc`
