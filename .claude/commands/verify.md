---
description: Run the checks that fit the current change and report the results
---

Run the checks for the current change on this branch and report them.

1. `git status --short` and `git diff --stat main...HEAD` to see what changed (committed and uncommitted).
2. Always: `npm run typecheck`.
3. If anything under `apps/api/` or `packages/shared/` changed: `npm test`.
4. If anything under `apps/web/` or `packages/shared/` changed: `npm run test:web` and `npm run build -w web`.
5. Lint only the changed `.ts`/`.tsx` files (`npx eslint <file>` from `apps/web` or `apps/api`). Name lint errors that already exist on `main` as older, not as new.

Report in German as a short table: check, result, and the failing output in full if something fails. Do not fix anything unless the user asks.
