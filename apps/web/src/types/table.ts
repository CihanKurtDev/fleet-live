import type { ReactNode } from "react";

type SortDirection = "asc" | "desc";

export type SortConfig<T> = {
    key: keyof T;
    direction: SortDirection;
} | null;

export type RenderContext<RowType> = {
    row: RowType;
    isSelected: boolean;
    /** Selection mode is on (same value as `selectionMode`). */
    isEditing: boolean;
    /** Selection mode is on: a row button hides itself (`return null`). */
    selectionMode: boolean;
    onSelect: () => void;
};

export type TableColumn<T> = {
    [K in keyof T]: {
        key: K;
        displayText: string;

        /** Kurzer Kopf. displayText bleibt der ausgesprochene Name. */
        headerText?: string;

        /** Feste Breite. Ohne Angabe teilt sich die Spalte den Rest. */
        width?: string;

        sortable?: boolean;

        /**
         * Optionaler Wert, der zum Sortieren verwendet wird.
         * Wenn nicht vorhanden, wird der eigentliche Feldwert verwendet.
         */
        sortBy?: (row: T) => unknown;

        render?: (
            value: T[K],
            context: RenderContext<T>,
        ) => ReactNode;
    }
}[keyof T];

export interface TableFilter<RowType> {
    /**
     * Stabile Kennung des Filters.
     * Wird als React-Key und als aktiver Filter im Table-State verwendet.
     */
    id: string;

    displayText: string;
    customSearchFunc?: (row: RowType) => boolean;
}

export interface TableFilterWithCount<RowType>
    extends TableFilter<RowType> {
    count: number;
}

export interface TableStateProps<RowType> {
    search: string;
    filterId: string | null;
    sortConfig: SortConfig<RowType>;
    page: number;
    limit: number;
}

interface TableSelectAll {
    checked: boolean;
    indeterminate: boolean;
    disabled?: boolean;
    label: string;
    onChange: () => void;
}

export interface TableProps<RowType> {
    columns: TableColumn<RowType>[];
    rows: RowType[];

    getRowKey: (row: RowType) => string | number;

    /**
     * Selection mode (after "Auswählen"): the checkbox column appears and a
     * row click toggles the row instead of `onRowClick`.
     */
    selectionMode?: boolean;

    /** Older name for `selectionMode`. */
    isEditing?: boolean;

    selectedRows?: Array<string | number>;
    onSelectRow?: (key: string | number) => void;

    /**
     * Checkbox-Spalte ohne Bearbeiten-Modus: der Zeilenklick bleibt
     * `onRowClick`, ausgewählt wird nur über die Checkbox.
     */
    selectable?: boolean;

    /** Zeilen, die `false` liefern, bekommen keine Checkbox. */
    isRowSelectable?: (row: RowType) => boolean;

    /** Vorgelesener Name der Zeilen-Checkbox. */
    getRowSelectLabel?: (row: RowType) => string;

    /** Kopf-Checkbox für alle auswählbaren Zeilen der Seite. */
    selectAll?: TableSelectAll;

    onRowClick?: (row: RowType) => void;

    /** Zusätzliche Klassen pro Zeile (z. B. Problem-Hervorhebung). */
    getRowClassName?: (row: RowType) => string | undefined;

    sortConfig?: SortConfig<RowType>;
    onSort?: (key: keyof RowType) => void;

    isLoading?: boolean;
    skeletonRowCount?: number;

    /** Ersetzt „Keine Ergebnisse“, wenn die Tabelle leer und nicht am Laden ist. */
    emptyContent?: ReactNode;

    /** Sichtbar nur für Screenreader. Ohne Caption kein `<caption>`. */
    caption?: string;

    className?: string;
}
