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
    isLoading = false,
    skeletonRowCount = 10,
    emptyContent = "Keine Ergebnisse",
    caption,
}: TableProps<RowType>) => {
    const columnCount = isEditing
        ? columns.length + 1
        : columns.length;

    return (
        <div className={styles.tableContainer}>
            <table
                className={styles.table}
                aria-busy={isLoading}
            >
                {caption && (
                    <caption className={styles.visuallyHidden}>
                        {caption}
                    </caption>
                )}
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
                    {isLoading
                        ? Array.from(
                              { length: skeletonRowCount },
                              (_, rowIndex) => (
                                  <tr
                                      key={`skeleton-${rowIndex}`}
                                      className={styles.skeletonRow}
                                      aria-hidden="true"
                                  >
                                      {Array.from(
                                          { length: columnCount },
                                          (_, cellIndex) => (
                                              <td
                                                  key={cellIndex}
                                                  className={styles.tableCell}
                                              >
                                                  <span
                                                      className={
                                                          styles.skeletonBar
                                                      }
                                                  />
                                              </td>
                                          ),
                                      )}
                                  </tr>
                              ),
                          )
                        : rows.length > 0
                          ? rows.map((row) => {
                                const rowKey = getRowKey(row);

                                return (
                                    <TableRow
                                        key={rowKey}
                                        rowData={row}
                                        columns={columns}
                                        isSelected={selectedRows.includes(
                                            rowKey,
                                        )}
                                        isEditing={isEditing}
                                        onSelect={() => onSelectRow?.(rowKey)}
                                        onClick={() => onRowClick?.(row)}
                                    />
                                );
                            })
                          : (
                                <tr>
                                    <td
                                        colSpan={columnCount}
                                        className={styles.empty}
                                    >
                                        {emptyContent}
                                    </td>
                                </tr>
                            )}
                </tbody>
            </table>
        </div>
    );
};
