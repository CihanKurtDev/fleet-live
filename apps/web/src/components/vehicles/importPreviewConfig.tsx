import {
    IMPORT_ROW_ACTIONS,
    IMPORT_SHEET_KIND_LABELS,
    VEHICLE_TYPE_LABELS,
    type ImportPreviewRow,
    type ImportRowAction,
    type ImportSheetKind,
} from "@fleet-live/shared";

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
                    aria-label={`Aktion für ${IMPORT_SHEET_KIND_LABELS[kind]} Zeile ${row.row_index}`}
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
            {
                key: "phone",
                displayText: "Telefon",
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
            key: "vin",
            displayText: "VIN",
            render: (value) => value ?? "—",
        },
        {
            key: "vehicle_type",
            displayText: "Typ",
            render: (value) =>
                value ? VEHICLE_TYPE_LABELS[value] : "—",
        },
        {
            key: "depot",
            displayText: "Standort",
            render: (value) => value ?? "—",
        },
        {
            key: "hu_due_on",
            displayText: "HU",
            render: (value) => value ?? "—",
        },
        {
            key: "cost_center",
            displayText: "KSt",
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

