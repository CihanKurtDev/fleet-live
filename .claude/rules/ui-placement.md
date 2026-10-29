---
description: Fit new UI into the existing screen instead of dropping a new widget on top
---

# Screen fit

Before adding anything visible, name the block on that page it extends. Read that page's markup and styles first. The new thing uses one of those blocks.

The start page `/` fills the viewport under the header (`100svh`). The page does not grow to fit a new block. A new row takes its height from the charts.

Blocks 1–3 sit in the live band (`components/briefing/LiveBand`): the real fleet map (`LiveBandMap`, same tiles, dots and depot rings as `/fleet`, no controls, no place names) as a close-up of where most of the fleet is, behind the text. The empty band area is one link to `/fleet`; tiles and buttons keep their own targets.

1. Title (the one 56 px title in the app) and one sentence. For dispatchers the same row holds the compact „Erste Schritte“ checklist (open steps as links); it adds no height on desktop.
2. KPI tiles. Small uppercase label, one large number, optional hint. The whole tile is the link when the destination is that number. From 1200 px the seven status tiles (Offen, Kein Signal, Auf Fahrt, Standby, Werkstatt, Wenig Tank, Im Depot) and the three deadline tiles share one row, split by a dashed yellow line.
3. Deadline counts are three tiles of the same height: Überfällig, In N Tagen (N is the company lead, 30 from the catalog, „Heute“ when the lead is 0), Datum fehlt. Datum fehlt is not red. Each tile opens `/fristen` in that state, and the list total is that number. Names stay on that list. The dispatcher sets the lead and the licence-check interval on `/fristen`; a viewer only reads them.
4. „Heute dran“ (`components/briefing/TodayPanel`, `GET /api/today`) on the left over both chart rows, the two smaller charts on the right; the large monthly chart is gone, its figures stay in the month table. The list shows as many 48 px rows as fit, every kind of task gets a share, one action per row (Eintragen opens the edit dialog on Schicht, Erledigen resolves an OFFLINE warning), a row click opens the vehicle or driver. A count chip exists only for a task kind that has no tile on the page (Werkstatt fällig, Gespräch führen, Fristen bald fällig); Überfällig, Kein Signal and Wenig Tank are counted by their tile, not twice. Each chip opens the list with exactly those rows. Kein Signal and Wenig Tank rows have no row button: those warnings close themselves. Charts fill the rest. Chart rows never shrink below their content (`minmax(min-content, 1fr)`); if they would, the page scrolls instead of legends spilling into the next block.
5. The only table sits behind "Exakte Monatswerte anzeigen".

A count belongs in a tile. A long list belongs on the list page that already sorts that thing, or behind the same disclosure as the month table.

If a region scrolls, the last column stays clear of the scrollbar: `scrollbar-gutter: stable` and padding at the end. Check that edge in the browser with the real amount of data. A screenshot that only shows the feature is there is not a layout check.

If the new thing matches no block on the page, stop and say which block is missing before writing the component.
