import { memo } from "react";
import { Checkbox } from "../Checkbox/Checkbox";
import type {
    RenderContext,
    TableColumn,
} from "../../../types/table";
import styles from "./Table.module.scss";

interface TableRowProps<RowType> {
    rowData: RowType;
    columns: TableColumn<RowType>[];

    isSelected: boolean;
    /** Selection mode: a row click toggles the row. */
    isEditing: boolean;
    /** Checkbox-Spalte sichtbar (Bearbeiten-Modus oder `selectable`). */
    showSelect?: boolean;
    /** Diese Zeile hat eine Checkbox. */
    canSelect?: boolean;
    selectLabel?: string;
    interactive: boolean;
    rowClassName?: string;

    onSelect: () => void;
    onClick?: () => void;
}

const TableRowComponent = <RowType,>({
    rowData,
    columns,
    isSelected,
    isEditing,
    showSelect = isEditing,
    canSelect = true,
    selectLabel = "Zeile auswählen",
    interactive,
    rowClassName,
    onSelect,
    onClick,
}: TableRowProps<RowType>) => {

    const renderContext: RenderContext<RowType> = {
        row: rowData,
        isSelected,
        isEditing,
        selectionMode: isEditing,
        onSelect,
    };

    const handleRowClick = () => {
        if (!interactive) {
            return;
        }

        if (isEditing) {
            onSelect();
            return;
        }

        onClick?.();
    };

    const className = [
        styles.tableRow,
        interactive && styles.tableRowInteractive,
        isSelected && styles.tableRowSelected,
        rowClassName,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <tr
            className={className}
            onClick={interactive ? handleRowClick : undefined}
            onKeyDown={(event) => {
                // Enter on a row button belongs to that button.
                if (
                    !interactive ||
                    isEditing ||
                    !onClick ||
                    event.target !== event.currentTarget
                ) {
                    return;
                }

                if (event.key === "Enter") {
                    event.preventDefault();
                    onClick();
                }
            }}
            tabIndex={interactive && !isEditing && onClick ? 0 : undefined}
            data-selected={isSelected || undefined}
            // Without a checkbox column the selected row is the one shown
            // elsewhere (the trip on the map): that is "current", not a
            // multi-selection (aria-selected needs a grid role).
            aria-current={!showSelect && isSelected ? "true" : undefined}
        >
            {showSelect && (
                <td
                    className={`${styles.tableCell} ${styles.selectCell}`}
                    data-col="select"
                    // Der Klick auf die Checkbox darf nicht zusätzlich
                    // über die Zeile ausgewertet werden.
                    onClick={
                        canSelect
                            ? (event) => event.stopPropagation()
                            : undefined
                    }
                >
                    {canSelect && (
                        <Checkbox
                            checked={isSelected}
                            onChange={onSelect}
                            aria-label={selectLabel}
                        />
                    )}
                </td>
            )}

            {columns.map((column) => {
                const value = rowData[column.key];

                const content = column.render
                    ? column.render(value, renderContext)
                    : String(value ?? "-");

                return (
                    <td
                        key={String(column.key)}
                        className={styles.tableCell}
                        data-col={String(column.key)}
                        data-label={column.displayText}
                    >
                        {content}
                    </td>
                );
            })}
        </tr>
    );
};

export const TableRow = memo(
    TableRowComponent,
) as typeof TableRowComponent;
