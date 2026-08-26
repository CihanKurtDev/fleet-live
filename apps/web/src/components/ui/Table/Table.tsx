import type { TableProps } from "../../../types/table";
import { TableHeader } from "./TableHeader";
import { TableRow } from "./TableRow";
import styles from "./Table.module.scss";

export const Table = <RowType,>({
    columns,
    rows,
    getRowKey,
    isEditing = false,
    selectedRows = [],
    onSelectRow,
    onRowClick,
    sortConfig = null,
    onSort,
}: TableProps<RowType>) => {
    const columnCount = isEditing
        ? columns.length + 1
        : columns.length;

    return (
        <div className={styles.tableContainer}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        {isEditing && (
                            <th
                                scope="col"
                                className={`${styles.tableHeader} ${styles.selectCell}`}
                            >
                                <span className={styles.visuallyHidden}>
                                    Auswahl
                                </span>
                            </th>
                        )}

                        <TableHeader
                            columns={columns}
                            sortConfig={sortConfig}
                            onSort={onSort}
                        />
                    </tr>
                </thead>

                <tbody>
                    {rows.length > 0 ? (
                        rows.map((row) => {
                            const rowKey = getRowKey(row);

                            return (
                                <TableRow
                                    key={rowKey}
                                    rowData={row}
                                    columns={columns}
                                    isSelected={selectedRows.includes(rowKey)}
                                    isEditing={isEditing}
                                    onSelect={() => onSelectRow?.(rowKey)}
                                    onClick={() => onRowClick?.(row)}
                                />
                            );
                        })
                    ) : (
                        <tr>
                            <td
                                colSpan={columnCount}
                                className={styles.empty}
                            >
                                Keine Ergebnisse
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};
