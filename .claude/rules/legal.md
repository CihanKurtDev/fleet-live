---
description: Legal statements about deadlines (HU, UVV, driving licence) need a checked source
paths:
  - "packages/shared/src/models/dueRules.ts"
  - "packages/shared/src/models/dueDates.ts"
  - "apps/web/src/components/due/**"
  - "apps/api/src/models/due.model.ts"
---

# Legal statements

- The app shows a legal basis (paragraph, regulation) only when the rule in `DUE_RULES` has `verified: true`. Until then the UI names the rule type (`gesetzliche Frist`, `interne Vorgabe`) and how the date is calculated.
- `verified` is set by the user after checking the source (gesetze-im-internet.de, DGUV publications), not by Claude. Changing it updates `dueDates.test.ts` (`hides the legal basis until it is verified`).
- No fines, points, tolerance stages or other legal consequences in UI text unless they come from a verified catalog entry. Practical states ("abgelaufen", "seit N Tagen überfällig") are fine.
- The licence check interval is a company rule (`INTERNAL_DUE_NOTICE`), not a law.
