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
    return (
        <div className={styles.tableContainer}>
            <table className={styles.table}>
                <thead>
                    <tr>
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
                                colSpan={columns.length}
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