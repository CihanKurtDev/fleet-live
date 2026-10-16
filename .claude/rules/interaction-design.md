---
description: How to design or build a screen so every element has one clear job
---

# Designing a screen

Applies to canvas designs and to UI code alike. The page frame and building blocks are in `rules/design-system.md`; read it before designing.

## 1. Inventory before drawing

Read the page's code first (page, its table/toolbar components, its hooks) and write down:

- every action that exists today, its handler, and where it leads (route, dialog, download);
- who may use it (`dispatcher` / `viewer`);
- every clickable element and what a click does.

The design shows exactly these actions. Anything new is marked as new in the reply, never slipped in.

## 2. One element, one meaning

- A row has one click meaning. Today that is "open the detail page" for vehicles, drivers and alerts (an alert opens its vehicle).
- The affordance is the row hover: background plus pointer. No chevrons, arrows or extra icons to say "clickable".
- No links or second click targets inside a clickable row. The only exception is a row button for the page's main per-row action (e.g. Erledigen), and it does not navigate.

## 3. Selection only as a mode

- Checkboxes appear only after the user presses "Auswählen", and only on pages that have a bulk action.
- In selection mode a row click toggles the row, row buttons are hidden, and a selection bar replaces the toolbar: "N ausgewählt", the bulk actions, "Fertig". Escape also ends it.
- Viewers never see "Auswählen".

## 4. Same thing, same look

- One size for row buttons, one for toolbar and header buttons, across all pages.
- Labels come from the code ("Fahrzeug anlegen", "Fahrer anlegen", "Exportieren").
- Before showing a design, compare it with the sibling pages: header, filters, toolbar, row, footer must match.

## 5. Check before showing

Walk every element and answer: what happens on click, for which role, and does a sibling page do the same thing the same way. If an answer is unclear, the design is not done.

## 6. Dialogs and panels follow the same rules

A dialog that lists things (assign drivers, pick vehicles, bulk confirm) is a small list page: header with the one primary action, the list with rows that have one clear action each, and the same selection mode as every list ("Auswählen" → checkboxes → selection bar → "Fertig"). It never mixes checkboxes and per-row buttons for the same action, and it never has its own "Bearbeiten" mode.

## 7. Use it before you report it

Writing code is not checking it. Before saying a change is done:

- Open the real screen in the browser as the demo dispatcher and operate every path: open each dialog, switch each mode on and off, select, confirm, cancel, Escape, empty state, error state (e.g. the 409 of a driving vehicle).
- Measure for layout jumps: record positions of header, buttons and list before and after each state change; nothing may move that the user did not cause.
- Check the same screen as viewer and at 375 px.
- Read the screen like a user who has never seen it: for every element ask what it does, and whether a second element does the same thing.
- List what you did and saw in the report. "Tests pass" is not a review.
