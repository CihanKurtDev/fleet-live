import type {
    TableColumn,
    SortConfig,
} from "../../../types/table";
import styles from "./Table.module.scss";

interface TableHeaderProps<RowType> {
    columns: TableColumn<RowType>[];
    sortConfig: SortConfig<RowType>;
    onSort?: (key: keyof RowType) => void;
}

export const TableHeader = <RowType,>({
    columns,
    sortConfig,
    onSort,
}: TableHeaderProps<RowType>) => {
    return (
        <>
            {columns.map((column) => {
                const isSorted = sortConfig?.key === column.key;

                const direction = isSorted
                    ? sortConfig.direction
                    : null;

                return (
                    <th
                        key={String(column.key)}
                        scope="col"
                        className={styles.tableHeader}
                    >
                        {column.sortable && onSort ? (
                            <button
                                type="button"
                                className={styles.sortButton}
                                onClick={() => onSort(column.key)}
                            >
                                <span>
                                    {column.displayText}
                                </span>

                                <span
                                    aria-hidden="true"
                                    className={styles.sortIndicator}
                                >
                                    {direction === "asc" && "↑"}
                                    {direction === "desc" && "↓"}
                                    {!direction && "↕"}
                                </span>
                            </button>
                        ) : (
                            column.displayText
                        )}
                    </th>
                );
            })}
        </>
    );
};