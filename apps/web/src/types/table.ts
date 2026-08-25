import type { ReactNode } from "react";

export type SortDirection = "asc" | "desc";

export type SortConfig<T> = {
    key: keyof T;
    direction: SortDirection;
} | null;

export type RenderContext<RowType> = {
    row: RowType;
    isSelected: boolean;
    isEditing: boolean;
    onSelect: () => void;
};

export type TableColumn<T> = {
    [K in keyof T]: {
        key: K;
        displayText: string;

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
    displayText: string;
    customSearchFunc?: (row: RowType) => boolean;
}

export interface TableProps<RowType> {
    columns: TableColumn<RowType>[];
    rows: RowType[];

    getRowKey: (row: RowType) => string | number;

    isEditing?: boolean;

    selectedRows?: Array<string | number>;
    onSelectRow?: (key: string | number) => void;

    onRowClick?: (row: RowType) => void;

    sortConfig?: SortConfig<RowType>;
    onSort?: (key: keyof RowType) => void;
}