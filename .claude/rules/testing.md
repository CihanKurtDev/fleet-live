---
description: Test conventions for the API (node:test + SuperTest) and the web app (Vitest)
paths:
  - "apps/api/**"
  - "apps/web/**"
  - "packages/shared/**"
---

# Testing

## API

- Runner: `node:test` + SuperTest in `apps/api/src/test/`.
- Command: `npm test` (root → `api` workspace). Uses in-memory SQLite via `src/test/env.ts`.
- Assert HTTP contracts and behavior (status, `code`, `fields`, list `meta`, SSE events) — not private SQL.
- Cover error paths (400/404/409) and focus/SSE behavior when touching those areas.
- A change to a `@fleet-live/shared` schema is an API change: add or adjust the API test in the same change.

## Web

- Runner: Vitest + Testing Library (jsdom) in `apps/web/src/test/`. Command: `npm run test:web`.
- Test what a user sees and does (text, roles, navigation), not component internals.
- Layout is checked in the browser, not in Vitest: measure the page at 1440×900, 1920×1080 and 375 px (see `rules/layout.md`).

## Always

- Never delete or weaken tests to make them pass. If a test is wrong, fix the assertion in the same change.
- Do not add another test runner.

After API or shared changes: `npm test`. After web changes: `npm run test:web`.
