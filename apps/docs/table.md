# Table-Komponente

Status: **Work in Progress** – Suche, Filter, Sortierung, Pagination und Zeilenauswahl sind umgesetzt. Die Daten kommen aktuell noch aus Mock-Daten (`mockVehicles` im `VehiclesProvider`), die API ist noch nicht angebunden.

## Überblick

Generische, typsichere Table-Komponente für React. Sie kennt keine fachlichen Details (z. B. "Fahrzeug") – die Spalten, Filter und deren Darstellung werden über eine Konfiguration von außen übergeben. Aktuell genutzt für die Fahrzeugliste (`VehicleTable`).

## Architektur

Die Table-Komponente ist eine generische, semantische HTML-Tabelle.
Sie enthält keine Vehicle-spezifische Logik.

Die Darstellung ist von der Zeilenlogik getrennt: `Table` rendert nur, `useTable` kümmert sich um Suche, Filter, Sortierung und Pagination.

```
Table
└── generische Darstellung
    ├── TableHeader
    └── TableRow

TableToolbar / TableFilterBar / TablePagination
└── generische Bedienelemente rund um die Tabelle

useTable
└── Zeilen-Pipeline und Table-State

VehicleTable
└── Vehicle-spezifische Verwendung
    └── vehicleTableConfig
```

Datenfluss:

```
API / Backend
    ↓
Vehicle (@fleet-live/shared)
    ↓
VehiclesProvider
    ↓
VehicleTable
    ↓
useTable
    ↓
Table
```

> Hinweis: Statt der API liefert aktuell `mocks/vehicles.ts` die `Vehicle`-Objekte. Da der Response-Typ der API derselbe ist, muss beim Anbinden nur der `VehiclesProvider` ausgetauscht werden.

## Dateistruktur

```
components/ui/Table/
  Table.tsx             – Hauptkomponente, rendert <table>
  TableHeader.tsx       – Kopfzeile inkl. Sortier-Buttons
  TableRow.tsx          – einzelne Zeile (memoized)
  TableToolbar.tsx      – Suchfeld und Aktionen (Bearbeiten, Neu, Löschen)
  TableFilterBar.tsx    – Filter-Chips mit Trefferanzahl
  TablePagination.tsx   – Seitennavigation und Zeilen pro Seite
  *.module.scss         – Styles

components/vehicles/
  VehicleTable.tsx        – konkrete Verwendung für Fahrzeuge
  vehicleTableConfig.ts   – Spalten, Filter und Suchfelder für Fahrzeuge

hooks/useTable.ts           – Zeilen-Pipeline und Table-State
hooks/useDebouncedValue.ts  – Verzögerung für die Sucheingabe
types/table.ts              – generische Typen
utils/sortRows.ts           – generische Sortierlogik
utils/getPageWindow.ts      – Seitenliste für die Pagination
```

## Generische Typen (`types/table.ts`)

- **`TableColumn<T>`** – definiert eine Spalte: `key`, `displayText`, optional `sortable`, `sortBy` (eigene Sortierlogik) und `render` (eigenes Rendering des Zellwerts).
- **`TableProps<RowType>`** – Props der `Table`-Komponente: `columns`, `rows`, `getRowKey`, `isEditing`, `selectedRows`, `onSelectRow`, `onRowClick`, `sortConfig`, `onSort`.
- **`SortConfig<T>`** – `{ key, direction: "asc" | "desc" } | null`.
- **`RenderContext<RowType>`** – wird an `column.render` übergeben (`row`, `isSelected`, `isEditing`, `onSelect`).
- **`TableFilter<RowType>`** – ein Filter: `id`, `displayText` und `customSearchFunc(row) => boolean`.
- **`TableFilterWithCount<RowType>`** – `TableFilter` plus `count` (Anzahl der Treffer), wird von `useTable` erzeugt.
- **`TableStateProps<RowType>`** – der Zustand der Tabelle: `search`, `filterId`, `sortConfig`, `page`, `limit`.

## Features

- **Suche** über die in `searchKeys` angegebenen Felder, um 250 ms verzögert (`useDebouncedValue`).
- **Filter** als Chips mit Trefferanzahl. Ein erneuter Klick auf den aktiven Filter hebt ihn auf.
- **Sortierung** pro Spalte, zyklisch `asc → desc → keine` (Originalreihenfolge).
- **Pagination** mit 10/25/50/100 Zeilen pro Seite und einem gleichbleibend breiten Seitenfenster.
- **Custom Rendering** je Spalte über `render(value, context)`, z. B. `fuel_level` → `"82%"`.
- **Zeilenauswahl** über den Bearbeitungsmodus (`isEditing`): ausgewählte Zeilen können gesammelt gelöscht werden. Im Bearbeitungsmodus wählt ein Klick auf die Zeile aus, statt zu navigieren.
- **Klickbare Zeilen** über `onRowClick`, in der Fahrzeugliste für die Navigation zur Detailseite.
- **Leerer Zustand**: Zeigt "Keine Ergebnisse", wenn `rows.length === 0`.

## Zeilen-Pipeline (`hooks/useTable.ts`)

`useTable` hält den kompletten Table-State und verarbeitet die Zeilen in fester Reihenfolge:

```
rows
  ↓ Suche (debounced, über searchKeys)
searchedRows
  ↓ Filter-Counts berechnen
  ↓ aktiver Filter
filteredRows
  ↓ Sortierung (sortRows)
sortedRows
  ↓ Pagination (page, limit)
paginatedRows
```

Zurückgegeben werden `tableState`, die Setter (`setSearch`, `setFilter`, `handleSort`, `setPage`, `setLimit`), `filtersWithCounts`, `filteredRows` (alles nach Suche/Filter/Sortierung), `paginatedRows` (die aktuelle Seite) und `pageCount`.

Details:

- Die **Filter-Counts** beziehen sich auf das Suchergebnis, aber bewusst nicht auf den gerade aktiven Filter. So bleibt sichtbar, wie viele Treffer die anderen Filter hätten.
- Suche, Filterwechsel und ein neues Limit setzen die Seite zurück auf 1.
- Liegt die aktuelle Seite nach dem Filtern hinter dem Ende, wird sie auf die letzte gültige Seite begrenzt (`safePage`).

## Sortierlogik (`utils/sortRows.ts`)

- `sortRows(rows, columns, sortConfig)` sortiert eine Kopie des Arrays (keine Mutation).
- Sortierwert je Zeile: `column.sortBy(row)`, falls vorhanden, sonst `row[column.key]`.
- `compareValues`:
  - `null`/`undefined` landen immer am Ende, unabhängig von der Richtung.
  - Zahlen werden numerisch verglichen.
  - Alles andere wird als String mit `localeCompare("de", { numeric: true, sensitivity: "base" })` verglichen (deutsche Sortierregeln, "natürliche" Zahlensortierung in Strings).

## Seitenfenster (`utils/getPageWindow.ts`)

`getPageWindow(page, pageCount, maxEntries = 7)` baut die Liste der Seiten-Buttons. Erste und letzte Seite sind immer sichtbar, dazwischen liegt ein Fenster um die aktuelle Seite:

```
getPageWindow(10, 20) → [1, "ellipsis-start", 9, 10, 11, "ellipsis-end", 20]
```

Nahe am Anfang oder Ende wird das Fenster zur Gegenseite aufgefüllt, damit die Leiste ihre Breite behält.

## Verwendungsbeispiel

```tsx
const {
  tableState,
  setSearch,
  setFilter,
  handleSort,
  setPage,
  setLimit,
  filtersWithCounts,
  filteredRows,
  paginatedRows,
  pageCount,
} = useTable({
  rows: vehicles,
  columns: vehicleColumns,
  searchKeys: vehicleSearchKeys,
  filters: vehicleFilters,
});

<Table
  columns={vehicleColumns}
  rows={paginatedRows}
  getRowKey={(vehicle) => vehicle.id}
  sortConfig={tableState.sortConfig}
  onSort={handleSort}
/>;
```

Spalten-, Filter- und Suchkonfiguration siehe `vehicleTableConfig.ts` (Kennzeichen, Fahrer, Status, Tank, Geschwindigkeit, Warnungen).

## Offene Punkte (noch nicht umgesetzt)

- [x] Zeilenauswahl (`selectedRows`/`onSelectRow`) tatsächlich in `VehicleTable` nutzen
- [x] Suche und Filterung über den Zeilen
- [ ] Aktions-Buttons pro Zeile
- [ ] Card-Ansicht (vermutlich für Mobile) als Alternative zur Tabelle
- [ ] Anbindung an echte API-Daten statt `mockVehicles`
- [ ] ggf. eigene `sortBy`-Logik für `status` (fachliche statt alphabetischer Reihenfolge, ist als Kommentar in `vehicleTableConfig.ts` bereits skizziert)
- [ ] Bestätigungsdialog vor dem Löschen ausgewählter Zeilen
