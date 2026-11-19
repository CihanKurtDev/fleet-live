---
description: Check a screen or design the way the user reads it, before showing it or calling it done — every number sourced, plausible, at 0/1/normal/huge, the job behind it, a reviewer without context, and an honest report
argument-hint: "<path or design, e.g. /alerts or the Schicht charts>"
---

Check `$ARGUMENTS` before it is shown to the user, before a design is offered and before anything is called done or put in a PR. Do every step and show its result in the report. „Tests pass“ and „works“ are not results of this check.

## 1. The job

Write in one sentence who stands in front of this screen and what they do in the next five minutes (`rules/complete-the-action.md`). Name the page or block that already does that work. If the screen does not serve that job, that is the first finding, before any detail.

## 2. Every number has a source and agrees with its neighbours

Open the real screen (browser pane, demo dispatcher). List every number on it in a table: what it says, where it comes from (endpoint and field, or the SQL), and which other numbers on the screen it must agree with (tile and list total, „N ausgewählt“ and the tile, a sum and its parts, a chart and its table). Recompute each from the database or the API. A number whose source you cannot name, or two that do not fit together, is a finding.

## 3. Plausible per person, vehicle and day

Divide the counts by drivers, vehicles and days (warnings per driver and month, km per vehicle and day, trips per day). Say whether a fleet manager would believe them. Implausible demo data is fixed in the simulation or the data first (`rules/backend.md`, Dev data), not designed around.

## 4. Four volumes

Look at the screen with no rows (an empty company), one row, the dev data, and a huge company (50,000 vehicles and drivers, 1 million warnings, on a throwaway copy, never the dev database). For each, write what the screen says and whether it still makes sense; for the huge one also how long it takes. Where a volume cannot be shown in the browser, say so and say how it was checked instead.

## 5. A reviewer without context

Take screenshots of the screen (in the browser pane `computer` screenshot, plus `zoom` on its parts so all text is readable; the tool result names the saved file). Start a fresh agent and give it only the image files and this task, nothing about the app or this change:

> Du bist Fuhrparkleiter einer Spedition und siehst diese Seite zum ersten Mal. Was verstehst du nicht? Welche Zahlen passen nicht zusammen? Was willst du als Nächstes tun, und kannst du das hier?

Report its answers. Take each one seriously: say whether it is a real problem and what follows, never explain it away.

## 6. The report

- Findings first, each with what was seen and where.
- „Als Nutzer gelesen“: which screens, which role, which size and scheme, and what was read on them. „Geprüft“ is only written together with this list.
- „Nicht geprüft“: what the tools could not reach.

Fix nothing in this command unless the user asks; it reports.
