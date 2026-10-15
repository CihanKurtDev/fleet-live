import type { TableProps } from "../../../types/table";
import { Checkbox } from "../Checkbox/Checkbox";
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
    selectable = false,
    isRowSelectable,
    getRowSelectLabel,
    selectAll,
    onRowClick,
    getRowClassName,
    sortConfig = null,
    onSort,
    isLoading = false,
    skeletonRowCount = 10,
    emptyContent = "Keine Ergebnisse",
    caption,
    className,
}: TableProps<RowType>) => {
    const showSelect = isEditing || selectable;
    const columnCount = showSelect
        ? columns.length + 1
        : columns.length;
    const interactive = isEditing || Boolean(onRowClick);

    return (
        <div
            className={[styles.tableContainer, className]
                .filter(Boolean)
                .join(" ")}
            data-editing={isEditing ? "true" : "false"}
        >
            <table
                className={styles.table}
                aria-busy={isLoading}
            >
                {columns.some((column) => column.width) && (
                    <colgroup>
                        {showSelect && <col style={{ width: 36 }} />}
                        {columns.map((column) => (
                            <col
                                key={String(column.key)}
                                style={
                                    column.width
                                        ? { width: column.width }
                                        : undefined
                                }
                            />
                        ))}
                    </colgroup>
                )}
                {caption && (
                    <caption className={styles.visuallyHidden}>
                        {caption}
                    </caption>
                )}
                <thead>
                    <tr>
                        {showSelect && (
                            <th
                                scope="col"
                                className={`${styles.tableHeader} ${styles.selectCell}`}
                                data-col="select"
                            >
                                {selectAll ? (
                                    <Checkbox
                                        checked={selectAll.checked}
                                        indeterminate={selectAll.indeterminate}
                                        disabled={selectAll.disabled}
                                        onChange={selectAll.onChange}
                                        aria-label={selectAll.label}
                                    />
                                ) : (
                                    <span className={styles.visuallyHidden}>
                                        Auswahl
                                    </span>
                                )}
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
                                        showSelect={showSelect}
                                        canSelect={
                                            isRowSelectable?.(row) ?? true
                                        }
                                        selectLabel={getRowSelectLabel?.(row)}
                                        interactive={interactive}
                                        rowClassName={getRowClassName?.(row)}
                                        onSelect={() => onSelectRow?.(rowKey)}
                                        onClick={
                                            onRowClick
                                                ? () => onRowClick(row)
                                                : undefined
                                        }
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
