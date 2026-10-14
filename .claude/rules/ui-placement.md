---
description: Fit new UI into the existing screen instead of dropping a new widget on top
---

# Screen fit

Before adding anything visible, name the block on that page it extends. Read that page's markup and styles first. The new thing uses one of those blocks.

The start page `/` fills the viewport under the header (`100svh`). The page does not grow to fit a new block. A new row takes its height from the charts.

1. Title and one sentence.
2. KPI tiles. Small uppercase label, one large number, optional hint. The whole tile is the link when the destination is that number.
3. Deadline counts are three tiles of the same height: Überfällig, In N Tagen (N is the company lead, 30 from the catalog, „Heute“ when the lead is 0), Datum fehlt. Datum fehlt is not red. Each tile opens `/fristen` in that state, and the list total is that number. Names stay on that list. The dispatcher sets the lead and the licence-check interval on `/fristen`; a viewer only reads them.
4. Charts, filling the rest.
5. The only table sits behind "Exakte Monatswerte anzeigen".

A count belongs in a tile. A long list belongs on the list page that already sorts that thing, or behind the same disclosure as the month table.

If a region scrolls, the last column stays clear of the scrollbar: `scrollbar-gutter: stable` and padding at the end. Check that edge in the browser with the real amount of data. A screenshot that only shows the feature is there is not a layout check.

If the new thing matches no block on the page, stop and say which block is missing before writing the component.
