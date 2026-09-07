import type {
    ImportColumnMapping,
    ImportColumnTarget,
    ImportCommitResult,
    ImportPreviewCounts,
    ImportPreviewResponse,
    ImportPreviewRow,
    ImportRowAction,
    ImportRowIssue,
    ImportStatusMapping,
    VehicleStatus,
} from "@fleet-live/shared";
import {
    FUEL_LEVEL_MAX,
    FUEL_LEVEL_MIN,
    isVehicleStatus,
    LICENSE_PLATE_MAX,
    VEHICLE_STATUSES,
} from "@fleet-live/shared";
import { parseCsv, type CsvTable } from "../lib/csvParse";
import {
    deleteImportPreview,
    getImportPreview,
    saveImportPreview,
} from "../lib/importPreviewStore";
import { DriverModel } from "./driver.model";
import { VehicleModel } from "./vehicle.model";
import { stmt } from "../db/statements";
import { TripModel } from "./trip.model";
import { TelemetryModel } from "./telemetry.model";
import { SpeedingEventModel } from "./speedingEvent.model";
import { NotFoundError } from "../lib/errors";

const COLUMN_HINTS: Array<{ pattern: RegExp; target: ImportColumnTarget }> = [
    { pattern: /kennzeichen|license|plate|nummer/i, target: "license_plate" },
    { pattern: /tank|fuel|kraftstoff/i, target: "fuel_level" },
    { pattern: /status|zustand|state/i, target: "status" },
    { pattern: /fahrer|driver|lenker/i, target: "driver_name" },
];

const STATUS_HINTS: Array<{ pattern: RegExp; status: VehicleStatus }> = [
    { pattern: /unterwegs|driving|fahrt|rollt/i, status: "DRIVING" },
    { pattern: /idle|bereit|frei|wartet|park/i, status: "IDLE" },
    { pattern: /stop|halt|steht|gestoppt/i, status: "STOPPED" },
    { pattern: /offline|aus|tot|kein signal/i, status: "OFFLINE" },
];

type ParsedImportRow = {
    row_index: number;
    license_plate: string | null;
    fuel_level: number | null;
    status: VehicleStatus | null;
    driver_name: string | null;
};

function suggestColumnMapping(columns: string[]): ImportColumnMapping {
    const mapping: ImportColumnMapping = {};
    const usedTargets = new Set<ImportColumnTarget>();

    for (const column of columns) {
        for (const hint of COLUMN_HINTS) {
            if (
                hint.target !== "ignore" &&
                usedTargets.has(hint.target)
            ) {
                continue;
            }

            if (hint.pattern.test(column)) {
                mapping[column] = hint.target;
                if (hint.target !== "ignore") {
                    usedTargets.add(hint.target);
                }
                break;
            }
        }

        if (!(column in mapping)) {
            mapping[column] = "ignore";
        }
    }

    return mapping;
}

function suggestStatusMapping(values: string[]): ImportStatusMapping {
    const mapping: ImportStatusMapping = {};

    for (const raw of values) {
        const trimmed = raw.trim();
        if (trimmed === "") {
            continue;
        }

        const upper = trimmed.toUpperCase();
        if (isVehicleStatus(upper)) {
            mapping[trimmed] = upper;
            continue;
        }

        for (const hint of STATUS_HINTS) {
            if (hint.pattern.test(trimmed)) {
                mapping[trimmed] = hint.status;
                break;
            }
        }
    }

    return mapping;
}

function findVehicleIdByPlate(
    companyId: number,
    licensePlate: string,
): number | undefined {
    const row = stmt(
        `
        SELECT id FROM vehicles
        WHERE company_id = ? AND license_plate = ?
        `,
    ).get(companyId, licensePlate) as { id: number } | undefined;

    return row?.id;
}

function driverExists(companyId: number, name: string): boolean {
    const row = stmt(
        `
        SELECT id FROM drivers
        WHERE company_id = ? AND name = ?
        `,
    ).get(companyId, name) as { id: number } | undefined;

    return row !== undefined;
}

function parseFuelLevel(raw: string | undefined): {
    value: number | null;
    issue?: ImportRowIssue;
} {
    if (raw === undefined || raw.trim() === "") {
        return { value: null };
    }

    const normalized = raw.trim().replace(",", ".");
    const parsed = Number(normalized);

    if (!Number.isFinite(parsed)) {
        return {
            value: null,
            issue: {
                level: "warning",
                code: "INVALID_FUEL",
                message: `Tankstand „${raw.trim()}“ ist ungültig — Standard 100 %.`,
            },
        };
    }

    if (parsed < FUEL_LEVEL_MIN || parsed > FUEL_LEVEL_MAX) {
        return {
            value: null,
            issue: {
                level: "warning",
                code: "FUEL_OUT_OF_RANGE",
                message: `Tankstand ${parsed} % liegt außerhalb 0–100 — Standard 100 %.`,
            },
        };
    }

    return { value: parsed };
}

function parseStatus(
    raw: string | undefined,
    statusMapping: ImportStatusMapping,
): {
    value: VehicleStatus | null;
    unmapped?: string;
    issue?: ImportRowIssue;
} {
    if (raw === undefined || raw.trim() === "") {
        return { value: null };
    }

    const trimmed = raw.trim();
    const upper = trimmed.toUpperCase();

    if (isVehicleStatus(upper)) {
        return { value: upper };
    }

    const mapped = statusMapping[trimmed];
    if (mapped) {
        return { value: mapped };
    }

    return {
        value: null,
        unmapped: trimmed,
        issue: {
            level: "warning",
            code: "UNKNOWN_STATUS",
            message: `Status „${trimmed}“ ist unbekannt — Standard IDLE.`,
        },
    };
}

function mapTableRows(
    table: CsvTable,
    columnMapping: ImportColumnMapping,
    statusMapping: ImportStatusMapping,
): {
    rows: ParsedImportRow[];
    unmappedStatusValues: Set<string>;
} {
    const targetToIndex = new Map<ImportColumnTarget, number>();

    for (const [column, target] of Object.entries(columnMapping)) {
        const index = table.columns.indexOf(column);
        if (index >= 0 && target !== "ignore") {
            targetToIndex.set(target, index);
        }
    }

    const unmappedStatusValues = new Set<string>();
    const rows: ParsedImportRow[] = [];

    for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
        const rawRow = table.rows[rowIndex] ?? [];
        const read = (target: ImportColumnTarget): string | undefined => {
            const index = targetToIndex.get(target);
            if (index === undefined) {
                return undefined;
            }
            return rawRow[index];
        };

        const plateRaw = read("license_plate")?.trim() ?? "";
        const fuelParsed = parseFuelLevel(read("fuel_level"));
        const statusParsed = parseStatus(read("status"), statusMapping);

        if (statusParsed.unmapped) {
            unmappedStatusValues.add(statusParsed.unmapped);
        }

        const driverRaw = read("driver_name")?.trim() ?? "";

        rows.push({
            row_index: rowIndex + 1,
            license_plate: plateRaw === "" ? null : plateRaw,
            fuel_level: fuelParsed.value,
            status: statusParsed.value,
            driver_name: driverRaw === "" ? null : driverRaw,
        });
    }

    return { rows, unmappedStatusValues };
}

function buildPreviewRows(
    parsedRows: ParsedImportRow[],
    companyId: number,
): ImportPreviewRow[] {
    const platesInFile = new Map<string, number[]>();

    for (const row of parsedRows) {
        if (!row.license_plate) {
            continue;
        }

        const key = row.license_plate.toLowerCase();
        const existing = platesInFile.get(key) ?? [];
        existing.push(row.row_index);
        platesInFile.set(key, existing);
    }

    return parsedRows.map((row) => {
        const issues: ImportRowIssue[] = [];
        let defaultAction: ImportRowAction = "create";

        if (!row.license_plate) {
            issues.push({
                level: "error",
                code: "MISSING_PLATE",
                message: "Kennzeichen fehlt.",
            });
            defaultAction = "skip";
        } else if (row.license_plate.length > LICENSE_PLATE_MAX) {
            issues.push({
                level: "error",
                code: "PLATE_TOO_LONG",
                message: `Kennzeichen ist länger als ${LICENSE_PLATE_MAX} Zeichen.`,
            });
            defaultAction = "skip";
        } else {
            const duplicateRows =
                platesInFile.get(row.license_plate.toLowerCase()) ?? [];
            if (duplicateRows.length > 1) {
                issues.push({
                    level: "error",
                    code: "DUPLICATE_PLATE_IN_FILE",
                    message: `Kennzeichen ${row.license_plate} kommt mehrfach in der Datei vor.`,
                });
                defaultAction = "skip";
            } else {
                const existingId = findVehicleIdByPlate(
                    companyId,
                    row.license_plate,
                );
                if (existingId !== undefined) {
                    defaultAction = "skip";
                    issues.push({
                        level: "warning",
                        code: "EXISTING_PLATE",
                        message: `Kennzeichen ${row.license_plate} existiert bereits — standardmäßig überspringen.`,
                    });
                }
            }
        }

        if (row.status === "DRIVING") {
            issues.push({
                level: "warning",
                code: "DRIVING_STATUS",
                message: "Status DRIVING öffnet eine Fahrt — für den Import IDLE empfohlen.",
            });
        }

        return {
            row_index: row.row_index,
            license_plate: row.license_plate,
            fuel_level: row.fuel_level,
            status: row.status,
            driver_name: row.driver_name,
            default_action: defaultAction,
            issues,
        };
    });
}

function countPreview(rows: ImportPreviewRow[]): ImportPreviewCounts {
    let toCreate = 0;
    let toUpdate = 0;
    let toSkip = 0;
    let errors = 0;
    let warnings = 0;

    for (const row of rows) {
        const hasError = row.issues.some((issue) => issue.level === "error");
        if (hasError) {
            errors += 1;
            toSkip += 1;
            continue;
        }

        if (row.default_action === "create") {
            toCreate += 1;
        } else if (row.default_action === "update") {
            toUpdate += 1;
        } else {
            toSkip += 1;
        }

        if (row.issues.some((issue) => issue.level === "warning")) {
            warnings += 1;
        }
    }

    return {
        total_rows: rows.length,
        to_create: toCreate,
        to_update: toUpdate,
        to_skip: toSkip,
        errors,
        warnings,
    };
}

function assignDriverToVehicle(
    companyId: number,
    vehicleId: number,
    driverName: string,
): boolean {
    const existed = driverExists(companyId, driverName);
    const driverId = DriverModel.upsert(companyId, driverName);
    DriverModel.assignVehicle(driverId, vehicleId, companyId);

    const occupied = stmt(
        `
        SELECT id FROM vehicles
        WHERE current_driver_id = ?
        LIMIT 1
        `,
    ).get(driverId) as { id: number } | undefined;

    if (!occupied) {
        DriverModel.setCurrentVehicle(driverId, vehicleId, companyId);
    }

    return !existed;
}

function syncTripOnImport(
    vehicleId: number,
    previousStatus: VehicleStatus | undefined,
    status: VehicleStatus,
    companyId: number,
): void {
    if (previousStatus === status) {
        return;
    }

    if (status === "DRIVING") {
        TripModel.open(vehicleId);
        return;
    }

    if (previousStatus === "DRIVING") {
        TelemetryModel.recordStandstill(vehicleId);
        SpeedingEventModel.endForVehicle(vehicleId);
        TripModel.close(vehicleId);
        TripModel.pruneClosedForCompany(companyId);
    }
}

export class ImportModel {
    static preview(
        csv: string,
        companyId: number,
        userId: number,
        columnMappingInput?: ImportColumnMapping,
        statusMappingInput?: ImportStatusMapping,
    ): ImportPreviewResponse {
        const table = parseCsv(csv);

        if (table.columns.length === 0) {
            return {
                preview_id: "",
                columns: [],
                suggested_mapping: {},
                unmapped_status_values: [],
                rows: [],
                counts: {
                    total_rows: 0,
                    to_create: 0,
                    to_update: 0,
                    to_skip: 0,
                    errors: 0,
                    warnings: 0,
                },
                can_commit: false,
            };
        }

        const suggestedMapping = suggestColumnMapping(table.columns);
        const columnMapping = columnMappingInput ?? suggestedMapping;

        const statusColumn = Object.entries(columnMapping).find(
            ([, target]) => target === "status",
        )?.[0];
        const statusValues = new Set<string>();

        if (statusColumn) {
            const statusIndex = table.columns.indexOf(statusColumn);
            if (statusIndex >= 0) {
                for (const row of table.rows) {
                    const raw = row[statusIndex]?.trim();
                    if (raw) {
                        statusValues.add(raw);
                    }
                }
            }
        }

        const suggestedStatusMapping = suggestStatusMapping([...statusValues]);
        const statusMapping = {
            ...suggestedStatusMapping,
            ...statusMappingInput,
        };

        const { rows: parsedRows, unmappedStatusValues } = mapTableRows(
            table,
            columnMapping,
            statusMapping,
        );
        const previewRows = buildPreviewRows(parsedRows, companyId);
        const counts = countPreview(previewRows);
        const canCommit =
            counts.errors === 0 &&
            counts.to_create + counts.to_update > 0;

        const previewId = saveImportPreview({
            companyId,
            userId,
            rows: previewRows,
            columnMapping,
            statusMapping,
        });

        return {
            preview_id: previewId,
            columns: table.columns,
            suggested_mapping: suggestedMapping,
            unmapped_status_values: [...unmappedStatusValues].sort((a, b) =>
                a.localeCompare(b, "de"),
            ),
            rows: previewRows,
            counts,
            can_commit: canCommit,
        };
    }

    static commit(
        previewId: string,
        companyId: number,
        rowActionsInput?: Record<string, ImportRowAction>,
    ): ImportCommitResult {
        const stored = getImportPreview(previewId, companyId);
        if (!stored) {
            throw new NotFoundError("Import-Vorschau nicht gefunden.");
        }

        const result: ImportCommitResult = {
            created_vehicles: 0,
            updated_vehicles: 0,
            created_drivers: 0,
            skipped_rows: 0,
            failed_rows: 0,
            errors: [],
        };

        for (const row of stored.rows) {
            const actionKey = String(row.row_index);
            const action =
                rowActionsInput?.[actionKey] ?? row.default_action;

            const hasError = row.issues.some((issue) => issue.level === "error");
            if (hasError || action === "skip") {
                result.skipped_rows += 1;
                continue;
            }

            if (!row.license_plate) {
                result.skipped_rows += 1;
                continue;
            }

            const fuelLevel = row.fuel_level ?? 100;
            const status = row.status ?? "IDLE";

            try {
                if (action === "create") {
                    if (row.driver_name && !driverExists(companyId, row.driver_name)) {
                        result.created_drivers += 1;
                    }

                    const created = VehicleModel.create({
                        license_plate: row.license_plate,
                        fuel_level: fuelLevel,
                        status,
                        company_id: companyId,
                        driver_name: row.driver_name ?? undefined,
                    });

                    if (row.status === "DRIVING") {
                        syncTripOnImport(
                            created.id,
                            undefined,
                            status,
                            companyId,
                        );
                    }

                    result.created_vehicles += 1;
                } else if (action === "update") {
                    const vehicleId = findVehicleIdByPlate(
                        companyId,
                        row.license_plate,
                    );

                    if (vehicleId === undefined) {
                        result.failed_rows += 1;
                        result.errors.push({
                            row_index: row.row_index,
                            message: `Kennzeichen ${row.license_plate} wurde nicht gefunden.`,
                        });
                        continue;
                    }

                    const previous = VehicleModel.getById(
                        vehicleId,
                        companyId,
                    );
                    const updated = VehicleModel.update(
                        vehicleId,
                        {
                            fuel_level: fuelLevel,
                            status,
                        },
                        companyId,
                    );

                    if (!updated) {
                        result.failed_rows += 1;
                        result.errors.push({
                            row_index: row.row_index,
                            message: `Fahrzeug ${row.license_plate} konnte nicht aktualisiert werden.`,
                        });
                        continue;
                    }

                    syncTripOnImport(
                        vehicleId,
                        previous?.status,
                        status,
                        companyId,
                    );

                    if (row.driver_name) {
                        const createdDriver = assignDriverToVehicle(
                            companyId,
                            vehicleId,
                            row.driver_name,
                        );
                        if (createdDriver) {
                            result.created_drivers += 1;
                        }
                    }

                    result.updated_vehicles += 1;
                } else {
                    result.skipped_rows += 1;
                }
            } catch (error) {
                result.failed_rows += 1;
                result.errors.push({
                    row_index: row.row_index,
                    message:
                        error instanceof Error
                            ? error.message
                            : "Unbekannter Fehler beim Import.",
                });
            }
        }

        deleteImportPreview(previewId);
        return result;
    }
}

export { VEHICLE_STATUSES as importVehicleStatuses };
