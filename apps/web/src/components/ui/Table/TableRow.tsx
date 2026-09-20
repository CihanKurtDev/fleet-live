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
    isEditing: boolean;
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
    interactive,
    rowClassName,
    onSelect,
    onClick,
}: TableRowProps<RowType>) => {

    const renderContext: RenderContext<RowType> = {
        row: rowData,
        isSelected,
        isEditing,
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
                if (!interactive || isEditing || !onClick) {
                    return;
                }

                if (event.key === "Enter") {
                    event.preventDefault();
                    onClick();
                }
            }}
            tabIndex={interactive && !isEditing && onClick ? 0 : undefined}
            aria-selected={isSelected}
        >
            {isEditing && (
                <td
                    className={`${styles.tableCell} ${styles.selectCell}`}
                    // Der Klick auf die Checkbox darf nicht zusätzlich
                    // über die Zeile ausgewertet werden.
                    onClick={(event) => event.stopPropagation()}
                >
                    <Checkbox
                        checked={isSelected}
                        onChange={onSelect}
                        aria-label="Zeile auswählen"
                    />
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
