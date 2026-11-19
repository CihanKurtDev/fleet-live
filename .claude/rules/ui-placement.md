---
description: Fit new UI into the existing screen instead of dropping a new widget on top
---

# Screen fit

Before adding anything visible, name the block on that page it extends. Read that page's markup and styles first. The new thing uses one of those blocks.

The start page `/` fills the viewport under the header (`100svh`). The page does not grow to fit a new block. A new row takes its height from the charts.

Blocks 1–3 sit in the live band (`components/briefing/LiveBand`): the real fleet map (`LiveBandMap`, same tiles, dots and depot rings as `/fleet`, no controls, no place names) as a close-up of where most of the fleet is, behind the text. The empty band area is one link to `/fleet`; tiles and buttons keep their own targets.

1. Title (the one 56 px title in the app) and one sentence. For dispatchers the same row holds the compact „Erste Schritte“ checklist (open steps as links); it adds no height on desktop.
2. KPI tiles. Small uppercase label, one large number, optional hint. The whole tile is the link when the destination is that number. From 1440 px the seven status tiles (Offen, Kein Signal, Auf Fahrt, Standby, Ausfall, Wenig Tank, Im Depot) and the three deadline tiles share one row, split by a dashed yellow line; from 701 to 1439 px the ten tiles stand in two rows of five; on phones they are one strip that scrolls sideways, so „Heute“ starts within the first screen. Every deadline tile has its hint line (Datum vorbei, noch rechtzeitig, nicht prüfbar).
3. Deadline counts are three tiles of the same height: Überfällig, In N Tagen (N is the company lead, 30 from the catalog, „Heute“ when the lead is 0), Datum fehlt. Datum fehlt is not red. Each tile opens `/fristen` in that state, and the list total is that number. Names stay on that list. The dispatcher sets the lead and the licence-check interval on `/fristen`; a viewer only reads them.
4. Two panels side by side (`components/briefing/ShiftPlan`, `GET /api/today`), each scrolling inside itself: „Heute“ left, „Als Nächstes planen“ right. „Heute“ lists only what is in use, in three sections: darf oder kann heute nicht fahren (red edge), nicht geprüft, aber im Einsatz, läuft vor dem nächsten Werktag ab (on a Friday „vor Montag“, with „heute ist der letzte Werktag“). Licence rows stand alone (up to 5); other kinds fold into one row from three tasks, „N anzeigen“ opens them inline with a button each, „Alle N in der Liste“ when more exist than came along. The most urgent step is the one filled button. Its foot line says which part of each tile it lists („Aus den Kacheln: Überfällig 23 von 27 · …“). The plan is a list by date up to the company lead (`week_until`), with the same rows as „Heute“: only days that have something (never an empty day), a day head „Do 19.11. · 4“, three or more of a kind on a day fold into one row („4 Kontrollen fällig“ with the names, „4 anzeigen“), „Alle N in den Fristen“ when a day has more than came along, one row button (Datum eintragen, Kontrolle eintragen, Termin planen; a booked stay shows its date instead). After the last day one line says where the plan ends („Bis Fr 18.12. läuft im Einsatz sonst nichts ab.“); with nothing at all that line alone, with a link to the Fristen. A panel is as tall as its content and at most its row, so a short list leaves no empty box; the row's height comes from the window (`contain: size`), never from the list. Nothing of the old list is kept: Tempo and Wenig Tank are left to their tiles and pages. On desktop the row keeps at least 380 px; below that the page scrolls.
5. The two charts and the only table sit behind „Monatswerte und Verlauf anzeigen“ (`BriefingCharts`, one `details`).

A count belongs in a tile. A long list belongs on the list page that already sorts that thing, or behind the same disclosure as the month table.

If a region scrolls, the last column stays clear of the scrollbar: `scrollbar-gutter: stable` and padding at the end. Check that edge in the browser with the real amount of data. A screenshot that only shows the feature is there is not a layout check.

If the new thing matches no block on the page, stop and say which block is missing before writing the component.
