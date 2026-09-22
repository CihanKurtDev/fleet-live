import {
    IMPORT_ROW_ACTIONS,
    IMPORT_SHEET_KIND_LABELS,
    getImportRowOutcome,
    type ImportPreviewRow,
    type ImportRowAction,
    type ImportRowOutcome,
    type ImportSheetKind,
} from "@fleet-live/shared";

import type { TableColumn } from "../../types/table";
import { ImportPreviewStatusCell } from "./ImportPreviewStatusCell";
import styles from "./importPreviewConfig.module.scss";

const ROW_ACTION_LABELS: Record<ImportRowAction, string> = {
    create: "Neu anlegen",
    update: "Aktualisieren",
    skip: "Überspringen",
};

export type ImportPreviewTableRow = ImportPreviewRow & {
    action: ImportRowAction;
    outcome: ImportRowOutcome;
};

export function previewTableRow(
    row: ImportPreviewRow,
    action: ImportRowAction,
): ImportPreviewTableRow {
    return {
        ...row,
        action,
        outcome: getImportRowOutcome(row, action),
    };
}

export const unifiedImportPreviewColumns = (
    onActionChange: (
        row: ImportPreviewTableRow,
        action: ImportRowAction,
    ) => void,
): TableColumn<ImportPreviewTableRow>[] => [
    {
        key: "sheet_kind",
        displayText: "Blatt",
        render: (value: ImportSheetKind) => IMPORT_SHEET_KIND_LABELS[value],
    },
    {
        key: "row_index",
        displayText: "Zeile",
    },
    {
        key: "driver_name",
        displayText: "Fahrer",
        render: (value) =>
            value ? <span className={styles.driverName}>{value}</span> : "",
    },
    {
        key: "license_plate",
        displayText: "Kennzeichen",
        render: (value) => value ?? "",
    },
    {
        key: "outcome",
        displayText: "Status",
        render: (value) => <ImportPreviewStatusCell outcome={value} />,
    },
    {
        key: "action",
        displayText: "Aktion",
        render: (value, { row }) => {
            const blocked = row.outcome.status === "blocked";

            return (
                <select
                    className={styles.select}
                    value={value}
                    disabled={blocked}
                    aria-label={`Aktion für ${IMPORT_SHEET_KIND_LABELS[row.sheet_kind]} Zeile ${row.row_index}`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                        onActionChange(
                            row,
                            event.target.value as ImportRowAction,
                        );
                    }}
                >
                    {IMPORT_ROW_ACTIONS.map((option) => (
                        <option key={option} value={option}>
                            {ROW_ACTION_LABELS[option]}
                        </option>
                    ))}
                </select>
            );
        },
    },
];
