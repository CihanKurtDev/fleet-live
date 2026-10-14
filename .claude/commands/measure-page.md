---
description: Measure a page in the browser at the standard sizes (fit, overflow, overlap)
argument-hint: "<path, e.g. /fristen?state=overdue>"
---

Measure the page `$ARGUMENTS` of the running dev app (`http://localhost:5173`) in the browser pane. Follow `rules/layout.md`.

1. Make sure API (port 3000) and web (port 5173) run; start the missing one in the background.
2. If the page redirects to `/login`, sign in with `Dispatcher übernehmen` (demo account) and open the path again.
3. For each size 1440×900, 1920×1080 and 375×812 (mobile preset), set the viewport with dark color scheme, reload the page, wait until data has loaded, then measure with JavaScript:
   - `main.scrollHeight` / `main.clientHeight` (page scroll)
   - `scrollWidth - clientWidth` for `html`, `body`, `#root`, `main` (horizontal overflow)
   - elements with `scrollHeight > clientHeight` that clip content
   - overlapping siblings in the page (`getBoundingClientRect`)
4. Take one screenshot per size.
5. Reset the viewport to the desktop preset when done.

Report in German as a table per size: fits / scrolls by N px, horizontal overflow, clipped or overlapping elements. Do not change code.
