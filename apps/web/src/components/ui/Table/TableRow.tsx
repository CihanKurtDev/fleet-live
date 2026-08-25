import { memo } from "react";
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

    onSelect: () => void;
    onClick?: () => void;
}

const TableRowComponent = <RowType,>({
    rowData,
    columns,
    isSelected,
    isEditing,
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
        if (isEditing) {
            onSelect();
            return;
        }

        onClick?.();
    };

    return (
        <tr
            className={
                isSelected
                    ? styles.tableRowSelected
                    : undefined
            }
            onClick={handleRowClick}
            aria-selected={isSelected}
        >
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