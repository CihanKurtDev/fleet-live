---
description: Page height, layout fit and how to check it in the browser
paths:
  - "apps/web/**"
---

# Layout

- From 701 px wide a page fits the window: no page scrollbar at 1440×900 and above. Divide the height with grid or flex: fixed parts take their content height, one part takes the rest (`minmax(0, 1fr)` / `flex: 1 1 0; min-height: 0`).
- The flexible part never hides content silently. Give it a minimum that keeps it readable; below that the page may scroll. Never clip text or charts with `overflow: hidden` to make it fit.
- A list that must fill its space measures its height (`hooks/useBoundHeight.ts`, used with `allocateDueRows` in `components/due/DueLists.tsx`) instead of a fixed row count.
- A table inside a panel that must scroll gets its own scroll wrapper. On desktop the generic `.tableContainer` is `overflow: visible`, so a `max-height` on it alone does not scroll.
- Phones (≤ 700 px) scroll normally. Do not change phone layout as a side effect of a desktop change; check 375 px after every layout change.
- Visual redesigns start as a design on the canvas artifact and are built only after the user picks one. Do not restyle pages that the task does not name.

## Checking a layout

- Use the browser pane with the demo dispatcher (`Dispatcher übernehmen` on `/login`).
- Measure, do not judge from screenshots: `main.scrollHeight` vs `clientHeight`, `scrollWidth` vs `clientWidth` for html, body, `#root`, `main`, and whether elements overlap (`getBoundingClientRect`).
- Sizes: 1440×900, 1920×1080, 375 px; add 2560×1440 for wide-screen work.
- Reload after resizing the emulated viewport: the emulator does not fire `resize` events.
- Vite on Windows sometimes misses a file change. If the browser shows old code, `touch` the file and reload.
- Settings changed while testing go back to their old value before you finish; say so in the report.
