import type {
    ImportPreviewRow,
    ImportRowAction,
    ImportSheetKind,
} from "@fleet-live/shared";
import { IMPORT_ROW_ACTIONS } from "@fleet-live/shared";

import type { TableColumn } from "../../types/table";
import { vehicleStatusLabel } from "./vehicleStatus";
import styles from "./importPreviewConfig.module.scss";

const ROW_ACTION_LABELS: Record<ImportRowAction, string> = {
    create: "Neu anlegen",
    update: "Aktualisieren",
    skip: "Überspringen",
};

export type ImportPreviewTableRow = ImportPreviewRow & {
    action: ImportRowAction;
};

export const importPreviewColumns = (
    kind: ImportSheetKind,
    onActionChange: (row: ImportPreviewTableRow, action: ImportRowAction) => void,
): TableColumn<ImportPreviewTableRow>[] => {
    const actionColumn: TableColumn<ImportPreviewTableRow> = {
        key: "action",
        displayText: "Aktion",
        render: (value, { row }) => {
            const hasError = row.issues.some(
                (issue) => issue.level === "error",
            );

            return (
                <select
                    className={styles.select}
                    value={value}
                    disabled={hasError}
                    aria-label={`Aktion für ${kind} Zeile ${row.row_index}`}
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
    };

    const issuesColumn: TableColumn<ImportPreviewTableRow> = {
        key: "issues",
        displayText: "Hinweise",
        render: (value) =>
            value.length === 0 ? (
                "—"
            ) : (
                <div className={styles.issues}>
                    {value.map((issue) => (
                        <p
                            key={`${issue.code}-${issue.message}`}
                            className={
                                issue.level === "error"
                                    ? styles.issueError
                                    : styles.issueWarning
                            }
                        >
                            {issue.message}
                        </p>
                    ))}
                </div>
            ),
    };

    const indexColumn: TableColumn<ImportPreviewTableRow> = {
        key: "row_index",
        displayText: "Zeile",
    };

    if (kind === "drivers") {
        return [
            indexColumn,
            {
                key: "driver_name",
                displayText: "Fahrer",
                render: (value) => value ?? "—",
            },
            actionColumn,
            issuesColumn,
        ];
    }

    if (kind === "eligibility" || kind === "current") {
        return [
            indexColumn,
            {
                key: "license_plate",
                displayText: "Kennzeichen",
                render: (value) => value ?? "—",
            },
            {
                key: "driver_name",
                displayText: "Fahrer",
                render: (value) => value ?? "—",
            },
            actionColumn,
            issuesColumn,
        ];
    }

    return [
        indexColumn,
        {
            key: "license_plate",
            displayText: "Kennzeichen",
            render: (value) => value ?? "—",
        },
        {
            key: "fuel_level",
            displayText: "Tank",
            render: (value) =>
                value === null ? "100 % (Standard)" : `${value} %`,
        },
        {
            key: "status",
            displayText: "Status",
            render: (value) =>
                value ? vehicleStatusLabel(value) : "Standby (Standard)",
        },
        {
            key: "driver_name",
            displayText: "Fahrer",
            render: (value) => value ?? "—",
        },
        actionColumn,
        issuesColumn,
    ];
};

