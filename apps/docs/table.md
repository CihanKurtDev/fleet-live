# Table-Komponente

Status: Suche, Filter, Sortierung, Pagination und Zeilenauswahl sind umgesetzt. Die Fahrzeugliste ist **server-driven**: die API filtert, sortiert und paginiert, `useTable` mappt nur noch Meta und Facet-Counts auf die UI.

## Überblick

Generische, typsichere Table-Komponente für React. Sie kennt keine fachlichen Details (z. B. "Fahrzeug") – die Spalten, Filter und deren Darstellung werden über eine Konfiguration von außen übergeben. Aktuell genutzt für die Fahrzeugliste (`VehicleTable`).

## Architektur

Die Table-Komponente ist eine generische, semantische HTML-Tabelle.
Sie enthält keine Vehicle-spezifische Logik.

`Table` rendert Zeilen oder ein Skeleton. Fachliche List-Queries, Cache und Live-Patches liegen in den Vehicle-Hooks.

```
Table
└── generische Darstellung
    ├── TableHeader
    └── TableRow

TableToolbar / TableFilterBar / TablePagination
└── generische Bedienelemente rund um die Tabelle

useTable
└── Server-Modus: Facet-Counts und Pagination-Meta

VehicleTable
└── Vehicle-spezifische Verwendung
    ├── useVehicleListQuery   URL-State
    ├── useVehicleList        Fetch, Cache, Prefetch, Focus
    └── vehicleTableConfig
```

Datenfluss:

```
GET /api/vehicles  →  { data, meta }
GET /api/stream    →  connected (connection_id), TelemetryPatch
POST /api/stream/focus  →  { connection_id, ids }

VehicleTable
    ↓
useVehicleListQuery (searchParams)
    ↓
useVehicleList
    ↓
useTable (counts aus meta)
    ↓
Table
```

## Dateistruktur

```
components/ui/Table/
  Table.tsx             – Hauptkomponente, rendert <table> inkl. Skeleton
  TableHeader.tsx       – Kopfzeile inkl. Sortier-Buttons
  TableRow.tsx          – einzelne Zeile (memoized)
  TableToolbar.tsx      – Suchfeld und Aktionen (Bearbeiten, Neu, Löschen)
  TableFilterBar.tsx    – Filter-Chips mit Trefferanzahl
  TablePagination.tsx   – Seitennavigation und Zeilen pro Seite
  *.module.scss         – Styles

components/vehicles/
  VehicleTable.tsx        – konkrete Verwendung für Fahrzeuge
  vehicleTableConfig.ts   – Spalten, Filter und Suchfelder für Fahrzeuge

hooks/useTable.ts              – Meta/Counts auf die bestehende UI-Signatur
hooks/useVehicleListQuery.ts   – Table-State in der URL
hooks/useVehicleList.ts        – Liste laden, Cache, Prefetch, Telemetrie-Fokus
hooks/useVehicleStream.ts      – SSE abonnieren
hooks/useDebouncedValue.ts     – Verzögerung für die Sucheingabe
types/table.ts                 – generische Typen
utils/sortRows.ts              – noch für lokale Sortierung (nicht die Fahrzeugliste)
utils/getPageWindow.ts         – Seitenliste für die Pagination
```

## Generische Typen (`types/table.ts`)

- **`TableColumn<T>`** – definiert eine Spalte: `key`, `displayText`, optional `sortable`, `sortBy` (eigene Sortierlogik) und `render` (eigenes Rendering des Zellwerts).
- **`TableProps<RowType>`** – Props der `Table`-Komponente: `columns`, `rows`, `getRowKey`, `isEditing`, `selectedRows`, `onSelectRow`, `onRowClick`, `sortConfig`, `onSort`, `isLoading`, `skeletonRowCount`.
- **`SortConfig<T>`** – `{ key, direction: "asc" | "desc" } | null`.
- **`RenderContext<RowType>`** – wird an `column.render` übergeben (`row`, `isSelected`, `isEditing`, `onSelect`).
- **`TableFilter<RowType>`** – ein Filter: `id`, `displayText` und optionales `customSearchFunc` (nur relevant, wenn clientseitig gefiltert wird).
- **`TableFilterWithCount<RowType>`** – `TableFilter` plus `count` (Anzahl der Treffer), kommt bei der Fahrzeugliste aus `meta.counts`.
- **`TableStateProps<RowType>`** – der Zustand der Tabelle: `search`, `filterId`, `sortConfig`, `page`, `limit`.

## Features

- **Suche** über Kennzeichen und Fahrer, um 250 ms verzögert, als Query-Parameter an die API.
- **Filter** als Chips mit Trefferanzahl aus der Facet-Query (`alerts`, `low_fuel`, `driving`, `offline`). Ein erneuter Klick auf den aktiven Filter hebt ihn auf.
- **Sortierung** pro Spalte, zyklisch `asc → desc → keine`. Die API sortiert über eine Allowlist (`VEHICLE_SORT_KEYS`, inkl. `active_alerts`).
- **Pagination** mit 10/25/50/100 Zeilen pro Seite und einem gleichbleibend breiten Seitenfenster. State in der URL (`?page=`, `?limit=`).
- **Custom Rendering** je Spalte über `render(value, context)`, z. B. `fuel_level` → `"82%"`.
- **Zeilenauswahl** über den Bearbeitungsmodus (`isEditing`): ausgewählte Zeilen können gesammelt gelöscht werden. Im Bearbeitungsmodus wählt ein Klick auf die Zeile aus, statt zu navigieren.
- **Klickbare Zeilen** über `onRowClick`, in der Fahrzeugliste für die Navigation zur Detailseite.
- **Leerer Zustand**: Zeigt "Keine Ergebnisse", wenn `rows.length === 0` und nicht geladen wird.
- **Skeleton**: Platzhalterzeilen plus Retry bei 502/503/504, solange die API (z. B. nach einem Neustart) noch nicht erreichbar ist.
- **Live-Updates**: SSE-Patches für die aktuelle Seite und die Nachbarseiten. Focus ist pro SSE-Connection (`connection_id` aus dem `connected`-Event).

## Server-Modus (`hooks/useTable.ts`)

Für die Fahrzeugliste gilt:

```
API-Response
  ↓ data → Zeilen der aktuellen Seite
  ↓ meta.counts → Filter-Chips
  ↓ meta.pageCount / total → Pagination
```

Suche, Filterwechsel und ein neues Limit setzen die Seite in der URL zurück auf 1. Sortierung bleibt in der URL, damit Reload und Teilen dieselbe Sicht ergeben.

Clientseitiges `sortRows` wird für diese Tabelle nicht mehr verwendet.

## Sortierlogik (`utils/sortRows.ts`)

- `sortRows(rows, columns, sortConfig)` sortiert eine Kopie des Arrays (keine Mutation).
- Sortierwert je Zeile: `column.sortBy(row)`, falls vorhanden, sonst `row[column.key]`.
- `compareValues`:
  - `null`/`undefined` landen immer am Ende, unabhängig von der Richtung.
  - Zahlen werden numerisch verglichen.
  - Alles andere wird als String mit `localeCompare("de", { numeric: true, sensitivity: "base" })` verglichen.

Die Fahrzeug-API sortiert analog in SQL (Allowlist + `v.id` als Tiebreaker).

## Seitenfenster (`utils/getPageWindow.ts`)

`getPageWindow(page, pageCount, maxEntries = 7)` baut die Liste der Seiten-Buttons. Erste und letzte Seite sind immer sichtbar, dazwischen liegt ein Fenster um die aktuelle Seite:

```
getPageWindow(10, 20) → [1, "ellipsis-start", 9, 10, 11, "ellipsis-end", 20]
```

Nahe am Anfang oder Ende wird das Fenster zur Gegenseite aufgefüllt, damit die Leiste ihre Breite behält.

## Verwendungsbeispiel

```tsx
const {
  apiQuery,
  tableState,
  setSearch,
  setFilter,
  handleSort,
  setPage,
  setLimit,
} = useVehicleListQuery();

const { data, meta, isLoading, pageCount, total } = useVehicleList(apiQuery);

const { filtersWithCounts, paginatedRows } = useTable({
  rows: data,
  filters: vehicleFilters,
  counts: meta?.counts,
  pageCount,
  total,
  tableState,
  setSearch,
  setFilter,
  handleSort,
  setPage,
  setLimit,
});

<Table
  columns={vehicleColumns}
  rows={paginatedRows}
  getRowKey={(vehicle) => vehicle.id}
  sortConfig={tableState.sortConfig}
  onSort={handleSort}
  isLoading={isLoading}
/>;
```

Spalten-, Filter- und Suchkonfiguration siehe `vehicleTableConfig.ts` (Kennzeichen, Fahrer, Status, Tank, Geschwindigkeit, Warnungen).

## Offene Punkte (noch nicht umgesetzt)

- [x] Zeilenauswahl (`selectedRows`/`onSelectRow`) tatsächlich in `VehicleTable` nutzen
- [x] Suche und Filterung über den Zeilen
- [x] Anbindung an echte API-Daten
- [ ] Aktions-Buttons pro Zeile
- [ ] Card-Ansicht (vermutlich für Mobile) als Alternative zur Tabelle
- [ ] ggf. eigene `sortBy`-Logik für `status` (fachliche statt alphabetischer Reihenfolge, ist als Kommentar in `vehicleTableConfig.ts` bereits skizziert)
- [ ] Bestätigungsdialog vor dem Löschen ausgewählter Zeilen
- [ ] Seite außerhalb von `pageCount` auf die letzte gültige Seite klemmen
