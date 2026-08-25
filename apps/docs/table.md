# Table-Komponente

Status: **Work in Progress** – aktuell läuft die Komponente noch mit Mock-Daten (`mockVehicles` in `App.tsx`), es folgen noch Buttons, eine Card-Ansicht u. Ä.

## Überblick

Generische, typsichere Table-Komponente für React. Sie kennt keine fachlichen Details (z. B. "Fahrzeug") – die Spalten und deren Darstellung werden über eine Konfiguration von außen übergeben. Aktuell genutzt für die Fahrzeugliste (`VehicleTable`).

## Architektur

Die Table-Komponente ist eine generische, semantische HTML-Tabelle.
Sie enthält keine Vehicle-spezifische Logik.

Die Tabelle ist in drei Ebenen aufgeteilt:

```
Table
└── generische Darstellung
    ├── TableHeader
    └── TableRow

VehicleTable
└── Vehicle-spezifische Verwendung
    └── vehicleTableConfig

VehicleTableRow
└── UI-Modell für die Tabelle
```

Datenfluss:

```
API / Backend
    ↓
VehicleWithLastTelemetry
    ↓
Mapping
    ↓
VehicleTableRow
    ↓
VehicleTable
    ↓
Table
```

> Hinweis: Das Mapping `VehicleWithLastTelemetry → VehicleTableRow` ist noch nicht implementiert – aktuell wird `VehicleTableRow` direkt als Mock-Daten in `App.tsx` erzeugt.

## Dateistruktur

```
components/ui/Table/
  Table.tsx           – Hauptkomponente, rendert <table>
  TableHeader.tsx      – Kopfzeile inkl. Sortier-Buttons
  TableRow.tsx         – einzelne Zeile (memoized)
  Table.module.scss    – Styles

components/vehicles/
  VehicleTable.tsx        – konkrete Verwendung für Fahrzeuge
  vehicleTableConfig.ts   – Spaltendefinition für Fahrzeuge

types/table.ts       – generische Typen (TableColumn, TableProps, SortConfig, RenderContext)
utils/sortRows.ts    – generische Sortierlogik
```

## Generische Typen (`types/table.ts`)

- **`TableColumn<T>`** – definiert eine Spalte: `key`, `displayText`, optional `sortable`, `sortBy` (eigene Sortierlogik) und `render` (eigenes Rendering des Zellwerts).
- **`TableProps<RowType>`** – Props der `Table`-Komponente: `columns`, `rows`, `getRowKey`, `isEditing`, `selectedRows`, `onSelectRow`, `onRowClick`, `sortConfig`, `onSort`.
- **`SortConfig<T>`** – `{ key, direction: "asc" | "desc" } | null`.
- **`RenderContext<RowType>`** – wird an `column.render` übergeben (`row`, `isSelected`, `isEditing`, `onSelect`).

## Features

- **Sortierung** pro Spalte (auf-/absteigend/keine), gesteuert über `sortConfig` + `onSort` von außen (State liegt in `VehicleTable`, nicht in `Table` selbst).
- **Custom Rendering** je Spalte über `render(value, context)`, z. B. `fuel_level` → `"82%"`.
- **Zeilenauswahl** über `isEditing` + `selectedRows` + `onSelectRow` (vorbereitet, in `VehicleTable` aktuell nicht genutzt).
- **Klickbare Zeilen** über `onRowClick`.
- **Leerer Zustand**: Zeigt "Keine Ergebnisse", wenn `rows.length === 0`.

## Sortierlogik (`utils/sortRows.ts`)

- `sortRows(rows, columns, sortConfig)` sortiert eine Kopie des Arrays (keine Mutation).
- Sortierwert je Zeile: `column.sortBy(row)`, falls vorhanden, sonst `row[column.key]`.
- `compareValues`:
  - `null`/`undefined` landen immer am Ende, unabhängig von der Richtung.
  - Zahlen werden numerisch verglichen.
  - Alles andere wird als String mit `localeCompare("de", { numeric: true, sensitivity: "base" })` verglichen (deutsche Sortierregeln, "natürliche" Zahlensortierung in Strings).

`VehicleTable` verwaltet den `sortConfig`-State selbst und zyklisiert bei Klick auf denselben Spaltenkopf durch `asc → desc → null` (Originalreihenfolge).

## Verwendungsbeispiel

```tsx
<Table
  columns={vehicleColumns}
  rows={sortedVehicles}
  getRowKey={(vehicle) => vehicle.id}
  sortConfig={sortConfig}
  onSort={handleSort}
/>
```

Spaltenkonfiguration siehe `vehicleTableConfig.ts` (Kennzeichen, Fahrer, Status, Tank, Geschwindigkeit, Warnungen).

## Offene Punkte (noch nicht umgesetzt)

- [ ] Aktions-Buttons pro Zeile
- [ ] Card-Ansicht (vermutlich für Mobile) als Alternative zur Tabelle
- [ ] TableCard: Suche/Filterung über den Zeilen
- [ ] Mapping `VehicleWithLastTelemetry → VehicleTableRow` implementieren, Anbindung an echte API-Daten statt `mockVehicles`
- [ ] Zeilenauswahl (`selectedRows`/`onSelectRow`) tatsächlich in `VehicleTable` nutzen
- [ ] ggf. eigene `sortBy`-Logik für `status` (fachliche statt alphabetischer Reihenfolge, ist als Kommentar in `vehicleTableConfig.ts` bereits skizziert)