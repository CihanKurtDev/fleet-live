---
description: The shared page frame and building blocks every screen follows; check before creating or changing any UI
---

# Design system

The source design is board 0 on the canvas "fleet-live Ein Rahmen für alle Seiten" (https://claude.ai/artifact/3iV4K12uzw8ySatWcbVFiG) for the frame, and the "Leitstelle" boards L0–L5 on the same canvas for the look. This file is its written form. Every new page, block or dialog starts here: use an existing page type and block, or extend this file in the same change and say so. Click behaviour is in `rules/interaction-design.md`.

## Look ("Leitstelle")

- Colours are tokens in `index.css`; components never hard-code them. Dark is asphalt blue (`--bg` #0f131b, `--surface` #151b26); light follows the system setting (`--bg` #f3f5f8, white surfaces). `--accent-fill` (#ffc24b, road-marking yellow) fills the primary button, badges, the pressed-tile edge and the active nav line, always with `--on-accent` text. `--accent` is the same yellow as text on dark and #8a5a00 on light. Status colours stay: `--success`, `--warning`, `--status-off` (Feierabend, Funk), `--danger`.
- Type: `--heading` Big Shoulders Display (upper case) for page titles (34 px), panel titles (20 px), dialog titles and big numbers; `--sans` IBM Plex Sans for text; `--mono` IBM Plex Mono for labels, tags, plates in lists, table headers and axes. Fonts are self-hosted (`@fontsource`, Latin subsets).
- Tags (status, alert type, hints) are outlined: status colour as text and a 42 % border, no fill, mono capitals.
- Map: Esri dark grey tiles mapped onto the Leitstelle colours by zoom-matched SVG filters (`fl-tiles-dark-63/65/71` in `leafletMap.ts`; the land grey changes with the tile zoom), land one step lighter than the page and water clearly darker (variant C on the canvas), place names only from city zoom; light mode keeps a soft blue tint. The roads the fleet drives on are the strongest line (`fleetMapStyle.ts`, hidden from street zoom). Dots and depot rings come from `fleetMapStyle.ts` for `/fleet` and the Schicht band alike: vehicles as 4 px dots in the status colour without outline, the selected one with a yellow ring, groups as a thin status ring around the count, depots as thin rings with the name in mono capitals. The selected trip is drawn in `--accent-fill`.
- Light and dark: `index.html` sets `data-theme` on `<html>` before the first paint, `utils/theme.ts` keeps it (system setting until someone picks the other scheme; picking the system scheme goes back to following it). Never `@media (prefers-color-scheme)` in components; use `:root[data-theme="dark"]`, and in canvas code `isDarkTheme()` / `onThemeChange()`. The header switch (`ThemeToggle`, next to the "?") shows where it switches to: the sun in the dark scheme, the moon with three stars in the light one. The switch dims the page down and brings it back up in the other scheme ("Dimmer", 420 ms, `theme-switching` in index.css). Header items are centred in the bar (the logo caps would sit high on a shared baseline).
- Motion: only the `--dur-*` / `--ease-*` tokens and the keyframes in `styles/_motion.scss`. Dialogs pop in and fade out (Escape closes natively, without the fade), menus drop in, drawers slide, the selection bar drops in, new rows and events rise in, a changed number glows once, routes cross-fade (`viewTransition` on links and row navigation). `hooks/usePresence` keeps a closing element for its exit. Reduced motion turns all of it off.

## Page types

- **Übersicht** (`/`, `/fleet`): header, KPI tiles, then charts or the map. Each tile leads to the matching list.
- **Liste** (`/vehicles`, `/alerts`, `/drivers`): header, KPI tiles as the main filter, one list panel. `/fristen` keeps its rail-and-groups layout but uses the same title, `KpiTiles`, control sizes and 48 px rows.
- **Detail** (`/vehicles/:id`, `/drivers/:id`): header with back link, name, status and actions; two columns from 1001 px. Left: Jetzt, Hinweise, Stammdaten. Right: the main record (map, list) and its history. Fits the window; phones stack.

## List page frame (top to bottom)

1. **Header**: h1 34 px (28 px on phones) on every page, one muted sentence with the situation below it. The sentence line is kept (non-breaking space) while it loads, so nothing below moves. Right: the page's actions for dispatchers, primary action last and filled ("Fahrzeug anlegen", "Fahrer anlegen"). Viewers see no action buttons.
2. **KPI tiles**: `ui/KpiTiles` on Fahrzeuge, Warnungen, Fahrer, Fristen and Karte (uppercase label, number, hint line). The hint line is always there, empty if needed, so every tile has one height (80 px desktop). A tile is a filter button with a pressed state; one is always active ("Alle" / "Offen").
3. **List panel** (one bordered panel that fills the remaining height):
   - Toolbar, 54 px: "Auswählen" first (only where a bulk action exists, dispatchers only), further filters as menus, search right-aligned.
   - Selection bar replaces the toolbar in selection mode: page checkbox, "N ausgewählt", optional summary, bulk actions, "Fertig".
   - Header row 38 px, muted 12 px labels, sort marks.
   - Rows 48 px: identity first (bold value plus muted second line), state in the middle, hints right, an optional 28 px row button last. Rows fill the measured height (`hooks/useBoundHeight`), no fixed 10.
   - Footer 48 px: "X–Y von N" left, pages right.

## Control sizes

Heights come from tokens in `index.css`; components use the tokens, not pixel values.

| Token | Desktop | Phone ≤ 700 px | Used by |
|---|---|---|---|
| `--control-xs` | 28 | 40 | the one row button (`Button size="row"`), icon actions, dialog close |
| `--control-sm` | 34 | 44 | header, toolbars, chips, toolbar search (`Input size="sm"`), pagination, panel buttons (`Button size="sm"`/`"toolbar"`) |
| `--control-md` | 36 | 44 | form and dialog fields (`Input size="md"`) and the dialog footer buttons next to them (`Button size="md"`) |
| `--control-lg` | 40 | 44 | sign-in pages only |

Controls that sit in one group share one size and one centre line. `apps/web/scripts/ui-measure.js` checks this in the browser (`alignment()`).

## Building blocks (one size each)

- Primary is filled accent; danger is red outline, filled red only inside a confirm dialog.
- Row button: one per row at most, never navigates.
- A control whose text changes with its state (Speichern / Wird gespeichert…, Depot anlegen / Klicken abbrechen) keeps its width: `Button` `busy` + `busyLabel`, or `ui/Button/SwapLabel` in a custom control.
- One focus indicator: 2 px outline in `--focus-ring` (`:focus-visible` in `index.css`, `--focus-width`). Do not replace it with a faint shadow; it must reach 3:1.
- Text colours come from tokens; tinted tags mix at most 12 % of their colour into the background so 12 px text stays at 4.5:1 in both schemes.
- Status pill (Auf Fahrt green, Standby amber, Feierabend grey, Kein Signal red) and hint tags (Tempo red, Funk grey, Tank amber) use the existing colour tokens.
- Confirm dialog for destructive or bulk actions: title with the count, one sentence, list of affected items, Abbrechen plus the action.
- Short `role="status"` line after every write that stays on the page ("3 Warnungen erledigt.", "Fahrzeug K-AB 1 angelegt.", "Mitglied entfernt."). A new action clears the old line. A create that opens the new record's page needs none.
- Dialogs: `Modal` keeps the header fixed and scrolls the body; form actions stick to the bottom, so Speichern is always reachable. Footer buttons are `md` like the fields. A confirm dialog focuses Abbrechen first; a form focuses its first (or `data-autofocus`) field. Removing a person or record always asks first in a confirm dialog (title, one sentence, the affected items, Abbrechen plus Löschen/Entfernen).
- A hint that asks for a value ("Eintragen") opens the edit dialog on that field: mark it `data-autofocus`; `Modal` focuses it before the first field.
- Empty list: one line plus "Filter aufheben" when a filter is active. A failed request shows only its error and "Erneut versuchen", never the empty line too. Detail pages show the error with a retry, not a lasting "wird geladen".
- Dialogs with a list (assignment roster, pickers): modal header with title and one muted sentence; below it a 54 px toolbar with the primary action ("Zuweisen") and "Auswählen"; rows 48 px with the row buttons that really exist; selection bar replaces the toolbar at the same height so nothing jumps.

## What each list can do

| Page | Row click | Header (dispatcher) | Bulk action | Row button |
|---|---|---|---|---|
| Fahrzeuge | opens the vehicle | Importieren, Exportieren (Fahrzeuge, Fahrten), Fahrzeug anlegen | Löschen | – |
| Warnungen | opens the alert's vehicle | Exportieren | Erledigen | Erledigen (open rows) |
| Fahrer | opens the driver | Fahrer anlegen | Löschen | – |

Update this table when a page gains or loses an action.

## Phones (≤ 700 px)

Controls grow for the thumb through the tokens above. The signed-in header uses the compact bar and the menu drawer below 1024 px. A list page's confirmation line floats above the bottom edge instead of pushing the list down.

Same order: title and sentence, tiles in a horizontal strip, search, cards (label above value). Selection mode puts the selection bar at the bottom of the screen.
