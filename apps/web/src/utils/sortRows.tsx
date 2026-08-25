import type {
    SortConfig,
    TableColumn,
} from "../types/table";

export const sortRows = <RowType,>(
    rows: RowType[],
    columns: TableColumn<RowType>[],
    sortConfig: SortConfig<RowType>,
): RowType[] => {
    if (!sortConfig) {
        return rows;
    }

    const column = columns.find(
        (column) => column.key === sortConfig.key,
    );

    if (!column) {
        return rows;
    }

    const getValue = (row: RowType) => {
        return column.sortBy
            ? column.sortBy(row)
            : row[column.key];
    };

    return [...rows].sort((a, b) => {
        const aValue = getValue(a);
        const bValue = getValue(b);

        return compareValues(
            aValue,
            bValue,
            sortConfig.direction,
        );
    });
};

const compareValues = (
    a: unknown,
    b: unknown,
    direction: "asc" | "desc",
): number => {
    const aMissing = a === null || a === undefined;
    const bMissing = b === null || b === undefined;

    // Fehlende Werte immer ans Ende.
    if (aMissing && bMissing) {
        return 0;
    }

    if (aMissing) {
        return 1;
    }

    if (bMissing) {
        return -1;
    }

    const multiplier = direction === "asc" ? 1 : -1;

    if (typeof a === "number" && typeof b === "number") {
        return (a - b) * multiplier;
    }

    return (
        String(a).localeCompare(
            String(b),
            "de",
            {
                numeric: true,
                sensitivity: "base",
            },
        ) * multiplier
    );
};