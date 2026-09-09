import type {
    ImportColumnMapping,
    ImportColumnTarget,
    ImportCommitResult,
    ImportPreviewCounts,
    ImportPreviewInput,
    ImportPreviewResponse,
    ImportPreviewRow,
    ImportPreviewSheet,
    ImportRowAction,
    ImportRowIssue,
    ImportSheetKind,
    ImportStatusMapping,
    VehicleStatus,
} from "@fleet-live/shared";
import {
    DRIVER_NAME_MAX,
    FUEL_LEVEL_MAX,
    FUEL_LEVEL_MIN,
    importActionKey,
    isVehicleStatus,
    LICENSE_PLATE_MAX,
    VEHICLE_STATUSES,
} from "@fleet-live/shared";
import { type CsvTable } from "../lib/csvParse";
import {
    assignSheetKinds,
    suggestColumnMapping,
} from "../lib/importSheets";
import { tablesFromImportInput } from "../lib/importSource";
import {
    deleteImportPreview,
    getImportPreview,
    saveImportPreview,
} from "../lib/importPreviewStore";
import { DriverModel } from "./driver.model";
import { VehicleModel } from "./vehicle.model";
import { stmt } from "../db/statements";
import { withTransaction } from "../db/database";
import { TripModel } from "./trip.model";
import { TelemetryModel } from "./telemetry.model";
import { SpeedingEventModel } from "./speedingEvent.model";
import {
    ConflictError,
    NotFoundError,
    isUniqueConstraintError,
} from "../lib/errors";

const STATUS_HINTS: Array<{ pattern: RegExp; status: VehicleStatus }> = [
    { pattern: /unterwegs|driving|fahrt|rollt/i, status: "DRIVING" },
    { pattern: /idle|standby|bereit|frei|wartet|park/i, status: "IDLE" },
    { pattern: /stop|halt|steht|gestoppt|feierabend/i, status: "STOPPED" },
    { pattern: /offline|aus|tot|kein signal/i, status: "OFFLINE" },
];

const COMMIT_ORDER: ImportSheetKind[] = [
    "drivers",
    "vehicles",
    "eligibility",
    "current",
];

type ParsedImportRow = {
    row_index: number;
    license_plate: string | null;
    fuel_level: number | null;
    status: VehicleStatus | null;
    driver_name: string | null;
};

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

function findDriverId(
    companyId: number,
    name: string,
): number | undefined {
    const row = stmt(
        `
        SELECT id FROM drivers
        WHERE company_id = ? AND name = ?
        `,
    ).get(companyId, name) as { id: number } | undefined;

    return row?.id;
}

function driverExists(companyId: number, name: string): boolean {
    return findDriverId(companyId, name) !== undefined;
}

function eligibilityExists(
    companyId: number,
    driverName: string,
    licensePlate: string,
): boolean {
    const row = stmt(
        `
        SELECT 1 AS ok
        FROM driver_vehicles dv
        INNER JOIN drivers d ON d.id = dv.driver_id
        INNER JOIN vehicles v ON v.id = dv.vehicle_id
        WHERE d.company_id = ?
          AND v.company_id = ?
          AND d.name = ?
          AND v.license_plate = ?
        LIMIT 1
        `,
    ).get(companyId, companyId, driverName, licensePlate) as
        | { ok: number }
        | undefined;

    return row !== undefined;
}

function parseFuelLevel(raw: string | undefined): number | null {
    if (raw === undefined || raw.trim() === "") {
        return null;
    }

    const normalized = raw.trim().replace(",", ".");
    const parsed = Number(normalized);

    if (
        !Number.isFinite(parsed) ||
        parsed < FUEL_LEVEL_MIN ||
        parsed > FUEL_LEVEL_MAX
    ) {
        return null;
    }

    return parsed;
}

function parseStatus(
    raw: string | undefined,
    statusMapping: ImportStatusMapping,
): {
    value: VehicleStatus | null;
    unmapped?: string;
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

    return { value: null, unmapped: trimmed };
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
        const statusParsed = parseStatus(read("status"), statusMapping);

        if (statusParsed.unmapped) {
            unmappedStatusValues.add(statusParsed.unmapped);
        }

        const driverRaw = read("driver_name")?.trim() ?? "";

        rows.push({
            row_index: rowIndex + 1,
            license_plate: plateRaw === "" ? null : plateRaw,
            fuel_level: parseFuelLevel(read("fuel_level")),
            status: statusParsed.value,
            driver_name: driverRaw === "" ? null : driverRaw,
        });
    }

    return { rows, unmappedStatusValues };
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

function sumCounts(sheets: ImportPreviewSheet[]): ImportPreviewCounts {
    const counts: ImportPreviewCounts = {
        total_rows: 0,
        to_create: 0,
        to_update: 0,
        to_skip: 0,
        errors: 0,
        warnings: 0,
    };

    for (const sheet of sheets) {
        counts.total_rows += sheet.counts.total_rows;
        counts.to_create += sheet.counts.to_create;
        counts.to_update += sheet.counts.to_update;
        counts.to_skip += sheet.counts.to_skip;
        counts.errors += sheet.counts.errors;
        counts.warnings += sheet.counts.warnings;
    }

    return counts;
}

function emptyCounts(): ImportPreviewCounts {
    return {
        total_rows: 0,
        to_create: 0,
        to_update: 0,
        to_skip: 0,
        errors: 0,
        warnings: 0,
    };
}

function emptyPreview(): ImportPreviewResponse {
    return {
        preview_id: "",
        sheets: [],
        columns: [],
        suggested_mapping: {},
        unmapped_status_values: [],
        rows: [],
        counts: emptyCounts(),
        can_commit: false,
    };
}

function withKind(
    kind: ImportSheetKind,
    row: Omit<ImportPreviewRow, "sheet_kind">,
): ImportPreviewRow {
    return { sheet_kind: kind, ...row };
}

function buildVehiclePreviewRows(
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

        return withKind("vehicles", {
            row_index: row.row_index,
            license_plate: row.license_plate,
            fuel_level: row.fuel_level,
            status: row.status,
            driver_name: row.driver_name,
            default_action: defaultAction,
            issues,
        });
    });
}

function buildDriverPreviewRows(
    parsedRows: ParsedImportRow[],
    companyId: number,
): ImportPreviewRow[] {
    const namesInFile = new Map<string, number[]>();

    for (const row of parsedRows) {
        if (!row.driver_name) {
            continue;
        }

        const key = row.driver_name.toLowerCase();
        const existing = namesInFile.get(key) ?? [];
        existing.push(row.row_index);
        namesInFile.set(key, existing);
    }

    return parsedRows.map((row) => {
        const issues: ImportRowIssue[] = [];
        let defaultAction: ImportRowAction = "create";

        if (!row.driver_name) {
            issues.push({
                level: "error",
                code: "MISSING_DRIVER",
                message: "Fahrername fehlt.",
            });
            defaultAction = "skip";
        } else if (row.driver_name.length > DRIVER_NAME_MAX) {
            issues.push({
                level: "error",
                code: "DRIVER_TOO_LONG",
                message: `Fahrername ist länger als ${DRIVER_NAME_MAX} Zeichen.`,
            });
            defaultAction = "skip";
        } else {
            const duplicateRows =
                namesInFile.get(row.driver_name.toLowerCase()) ?? [];
            if (duplicateRows.length > 1) {
                issues.push({
                    level: "error",
                    code: "DUPLICATE_DRIVER_IN_FILE",
                    message: `Fahrer ${row.driver_name} kommt mehrfach in der Datei vor.`,
                });
                defaultAction = "skip";
            } else if (driverExists(companyId, row.driver_name)) {
                defaultAction = "skip";
                issues.push({
                    level: "warning",
                    code: "EXISTING_DRIVER",
                    message: `Fahrer ${row.driver_name} existiert bereits — standardmäßig überspringen.`,
                });
            }
        }

        return withKind("drivers", {
            row_index: row.row_index,
            license_plate: null,
            fuel_level: null,
            status: null,
            driver_name: row.driver_name,
            default_action: defaultAction,
            issues,
        });
    });
}

function knownPlates(vehicleRows: ImportPreviewRow[]): Set<string> {
    const plates = new Set<string>();

    for (const row of vehicleRows) {
        if (
            row.license_plate &&
            !row.issues.some((issue) => issue.level === "error")
        ) {
            plates.add(row.license_plate.toLowerCase());
        }
    }

    return plates;
}

function knownNames(
    driverRows: ImportPreviewRow[],
    vehicleRows: ImportPreviewRow[],
): Set<string> {
    const names = new Set<string>();

    for (const row of driverRows) {
        if (
            row.driver_name &&
            !row.issues.some((issue) => issue.level === "error")
        ) {
            names.add(row.driver_name.toLowerCase());
        }
    }

    for (const row of vehicleRows) {
        if (
            row.driver_name &&
            !row.issues.some((issue) => issue.level === "error")
        ) {
            names.add(row.driver_name.toLowerCase());
        }
    }

    return names;
}

function plateKnown(
    companyId: number,
    plate: string,
    filePlates: Set<string>,
): boolean {
    return (
        filePlates.has(plate.toLowerCase()) ||
        findVehicleIdByPlate(companyId, plate) !== undefined
    );
}

function nameKnown(
    companyId: number,
    name: string,
    fileNames: Set<string>,
): boolean {
    return (
        fileNames.has(name.toLowerCase()) || driverExists(companyId, name)
    );
}

function buildLinkPreviewRows(
    kind: "eligibility" | "current",
    parsedRows: ParsedImportRow[],
    companyId: number,
    filePlates: Set<string>,
    fileNames: Set<string>,
): ImportPreviewRow[] {
    const pairs = new Map<string, number[]>();

    for (const row of parsedRows) {
        if (!row.license_plate || !row.driver_name) {
            continue;
        }

        const key = `${row.driver_name.toLowerCase()}|${row.license_plate.toLowerCase()}`;
        const existing = pairs.get(key) ?? [];
        existing.push(row.row_index);
        pairs.set(key, existing);
    }

    const currentByDriver = new Map<string, number[]>();
    if (kind === "current") {
        for (const row of parsedRows) {
            if (!row.driver_name) {
                continue;
            }

            const key = row.driver_name.toLowerCase();
            const existing = currentByDriver.get(key) ?? [];
            existing.push(row.row_index);
            currentByDriver.set(key, existing);
        }
    }

    return parsedRows.map((row) => {
        const issues: ImportRowIssue[] = [];
        let defaultAction: ImportRowAction = "create";

        if (!row.driver_name) {
            issues.push({
                level: "error",
                code: "MISSING_DRIVER",
                message: "Fahrername fehlt.",
            });
            defaultAction = "skip";
        }

        if (!row.license_plate) {
            issues.push({
                level: "error",
                code: "MISSING_PLATE",
                message: "Kennzeichen fehlt.",
            });
            defaultAction = "skip";
        }

        if (row.driver_name && row.license_plate && defaultAction !== "skip") {
            const duplicateRows =
                pairs.get(
                    `${row.driver_name.toLowerCase()}|${row.license_plate.toLowerCase()}`,
                ) ?? [];
            if (duplicateRows.length > 1) {
                issues.push({
                    level: "error",
                    code: "DUPLICATE_LINK_IN_FILE",
                    message: `${row.driver_name} / ${row.license_plate} kommt mehrfach vor.`,
                });
                defaultAction = "skip";
            }
        }

        if (
            kind === "current" &&
            row.driver_name &&
            defaultAction !== "skip"
        ) {
            const currentRows =
                currentByDriver.get(row.driver_name.toLowerCase()) ?? [];
            if (currentRows.length > 1) {
                issues.push({
                    level: "error",
                    code: "DUPLICATE_CURRENT_DRIVER",
                    message: `${row.driver_name} hat mehrere aktuelle Fahrzeuge in der Datei.`,
                });
                defaultAction = "skip";
            }
        }

        if (row.license_plate && defaultAction !== "skip") {
            if (!plateKnown(companyId, row.license_plate, filePlates)) {
                issues.push({
                    level: "error",
                    code: "UNKNOWN_PLATE",
                    message: `Kennzeichen ${row.license_plate} ist unbekannt — weder in der Datei noch im Bestand.`,
                });
                defaultAction = "skip";
            }
        }

        if (row.driver_name && defaultAction !== "skip") {
            if (!nameKnown(companyId, row.driver_name, fileNames)) {
                issues.push({
                    level: "error",
                    code: "UNKNOWN_DRIVER",
                    message: `Fahrer ${row.driver_name} ist unbekannt — weder in der Datei noch im Bestand.`,
                });
                defaultAction = "skip";
            }
        }

        if (
            kind === "eligibility" &&
            row.driver_name &&
            row.license_plate &&
            defaultAction !== "skip" &&
            eligibilityExists(companyId, row.driver_name, row.license_plate)
        ) {
            defaultAction = "skip";
            issues.push({
                level: "warning",
                code: "EXISTING_ELIGIBILITY",
                message: `${row.driver_name} darf ${row.license_plate} bereits fahren.`,
            });
        }

        if (
            kind === "current" &&
            row.driver_name &&
            row.license_plate &&
            defaultAction !== "skip"
        ) {
            const vehicleId = findVehicleIdByPlate(
                companyId,
                row.license_plate,
            );
            const driverId = findDriverId(companyId, row.driver_name);
            if (vehicleId !== undefined && driverId !== undefined) {
                const current = stmt(
                    `
                    SELECT current_driver_id FROM vehicles
                    WHERE id = ? AND company_id = ?
                    `,
                ).get(vehicleId, companyId) as
                    | { current_driver_id: number | null }
                    | undefined;

                if (current?.current_driver_id === driverId) {
                    defaultAction = "skip";
                    issues.push({
                        level: "warning",
                        code: "ALREADY_CURRENT",
                        message: `${row.driver_name} ist bereits aktuell auf ${row.license_plate}.`,
                    });
                }
            }
        }

        return withKind(kind, {
            row_index: row.row_index,
            license_plate: row.license_plate,
            fuel_level: null,
            status: null,
            driver_name: row.driver_name,
            default_action: defaultAction,
            issues,
        });
    });
}

function assignDriverToVehicle(
    companyId: number,
    vehicleId: number,
    driverName: string,
    setCurrentIfFree: boolean,
): boolean {
    const existed = driverExists(companyId, driverName);
    const driverId = DriverModel.upsert(companyId, driverName);
    DriverModel.assignVehicle(driverId, vehicleId, companyId);

    if (!setCurrentIfFree) {
        return !existed;
    }

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

function resolveAction(
    row: ImportPreviewRow,
    rowActionsInput?: Record<string, ImportRowAction>,
): ImportRowAction {
    const keyed = importActionKey(row.sheet_kind, row.row_index);
    return (
        rowActionsInput?.[keyed] ??
        (row.sheet_kind === "vehicles"
            ? rowActionsInput?.[String(row.row_index)]
            : undefined) ??
        row.default_action
    );
}

function abortRow(row: ImportPreviewRow, message: string): never {
    throw new ConflictError(
        `Import abgebrochen in ${row.sheet_kind} Zeile ${row.row_index}: ${message} Es wurde nichts übernommen.`,
        {},
    );
}

export class ImportModel {
    static preview(
        input: ImportPreviewInput,
        companyId: number,
        userId: number,
    ): ImportPreviewResponse {
        const tables = tablesFromImportInput(input);
        if (tables.length === 0 || tables.every((item) => item.table.columns.length === 0)) {
            return emptyPreview();
        }

        const kinds = assignSheetKinds(tables.map((item) => item.name));
        const sources = tables.flatMap((item, index) => {
            const kind = kinds[index];
            if (!kind) {
                return [];
            }

            return [{ kind, name: item.name, table: item.table }];
        });

        if (sources.length === 0) {
            return emptyPreview();
        }

        const parsedByKind = new Map<
            ImportSheetKind,
            {
                name: string;
                table: CsvTable;
                suggested: ImportColumnMapping;
                mapping: ImportColumnMapping;
                parsed: ParsedImportRow[];
                unmapped: string[];
            }
        >();

        for (const source of sources) {
            const suggested = suggestColumnMapping(
                source.kind,
                source.table.columns,
            );
            const mapping =
                input.sheet_mappings?.[source.kind] ??
                (source.kind === "vehicles" ? input.column_mapping : undefined) ??
                suggested;

            const statusValues = new Set<string>();
            const statusColumn = Object.entries(mapping).find(
                ([, target]) => target === "status",
            )?.[0];

            if (statusColumn) {
                const statusIndex = source.table.columns.indexOf(statusColumn);
                if (statusIndex >= 0) {
                    for (const row of source.table.rows) {
                        const raw = row[statusIndex]?.trim();
                        if (raw) {
                            statusValues.add(raw);
                        }
                    }
                }
            }

            const statusMapping = {
                ...suggestStatusMapping([...statusValues]),
                ...input.status_mapping,
            };

            const mapped = mapTableRows(source.table, mapping, statusMapping);
            parsedByKind.set(source.kind, {
                name: source.name,
                table: source.table,
                suggested,
                mapping,
                parsed: mapped.rows,
                unmapped: [...mapped.unmappedStatusValues].sort((a, b) =>
                    a.localeCompare(b, "de"),
                ),
            });
        }

        const vehicleParsed = parsedByKind.get("vehicles");
        const driverParsed = parsedByKind.get("drivers");
        const vehicleRows = vehicleParsed
            ? buildVehiclePreviewRows(vehicleParsed.parsed, companyId)
            : [];
        const driverRows = driverParsed
            ? buildDriverPreviewRows(driverParsed.parsed, companyId)
            : [];

        const filePlates = knownPlates(vehicleRows);
        const fileNames = knownNames(driverRows, vehicleRows);

        for (const kind of ["eligibility", "current"] as const) {
            for (const row of parsedByKind.get(kind)?.parsed ?? []) {
                if (row.driver_name) {
                    fileNames.add(row.driver_name.toLowerCase());
                }
            }
        }

        const sheets: ImportPreviewSheet[] = [];

        for (const kind of COMMIT_ORDER) {
            const parsed = parsedByKind.get(kind);
            if (!parsed) {
                continue;
            }

            let rows: ImportPreviewRow[];
            if (kind === "vehicles") {
                rows = vehicleRows;
            } else if (kind === "drivers") {
                rows = driverRows;
            } else {
                rows = buildLinkPreviewRows(
                    kind,
                    parsed.parsed,
                    companyId,
                    filePlates,
                    fileNames,
                );
            }

            sheets.push({
                kind,
                name: parsed.name,
                columns: parsed.table.columns,
                suggested_mapping: parsed.suggested,
                unmapped_status_values: parsed.unmapped,
                rows,
                counts: countPreview(rows),
            });
        }

        const rows = sheets.flatMap((sheet) => sheet.rows);
        const counts = sumCounts(sheets);
        const canCommit =
            counts.errors === 0 &&
            counts.to_create + counts.to_update > 0;

        const primary = sheets.find((sheet) => sheet.kind === "vehicles") ?? sheets[0];

        const previewId = saveImportPreview({
            companyId,
            userId,
            rows,
            columnMapping: primary?.suggested_mapping ?? {},
            statusMapping: input.status_mapping ?? {},
        });

        return {
            preview_id: previewId,
            sheets,
            columns: primary?.columns ?? [],
            suggested_mapping: primary?.suggested_mapping ?? {},
            unmapped_status_values: primary?.unmapped_status_values ?? [],
            rows,
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

        const hasCurrentSheet = stored.rows.some(
            (row) => row.sheet_kind === "current",
        );
        const result: ImportCommitResult = {
            created_vehicles: 0,
            updated_vehicles: 0,
            created_drivers: 0,
            assigned_eligibility: 0,
            set_current: 0,
            skipped_rows: 0,
            failed_rows: 0,
            errors: [],
        };

        try {
            withTransaction(() => {
                for (const kind of COMMIT_ORDER) {
                    for (const row of stored.rows) {
                        if (row.sheet_kind !== kind) {
                            continue;
                        }

                        const action = resolveAction(row, rowActionsInput);
                        const hasError = row.issues.some(
                            (issue) => issue.level === "error",
                        );
                        if (hasError || action === "skip") {
                            result.skipped_rows += 1;
                            continue;
                        }

                        if (kind === "drivers") {
                            if (!row.driver_name) {
                                result.skipped_rows += 1;
                                continue;
                            }

                            const created = !driverExists(
                                companyId,
                                row.driver_name,
                            );
                            DriverModel.upsert(companyId, row.driver_name);
                            if (created) {
                                result.created_drivers += 1;
                            }
                            continue;
                        }

                        if (kind === "vehicles") {
                            if (!row.license_plate) {
                                result.skipped_rows += 1;
                                continue;
                            }

                            const fuelLevel = row.fuel_level ?? 100;
                            const status = row.status ?? "IDLE";

                            if (action === "create") {
                                const createdDriver = Boolean(
                                    row.driver_name &&
                                        !driverExists(
                                            companyId,
                                            row.driver_name,
                                        ),
                                );

                                const created = VehicleModel.create({
                                    license_plate: row.license_plate,
                                    fuel_level: fuelLevel,
                                    status,
                                    company_id: companyId,
                                    driver_name: hasCurrentSheet
                                        ? undefined
                                        : (row.driver_name ?? undefined),
                                });

                                if (hasCurrentSheet && row.driver_name) {
                                    assignDriverToVehicle(
                                        companyId,
                                        created.id,
                                        row.driver_name,
                                        false,
                                    );
                                }

                                if (row.status === "DRIVING") {
                                    syncTripOnImport(
                                        created.id,
                                        undefined,
                                        status,
                                        companyId,
                                    );
                                }

                                if (createdDriver) {
                                    result.created_drivers += 1;
                                }

                                result.created_vehicles += 1;
                            } else if (action === "update") {
                                const vehicleId = findVehicleIdByPlate(
                                    companyId,
                                    row.license_plate,
                                );

                                if (vehicleId === undefined) {
                                    abortRow(
                                        row,
                                        `Kennzeichen ${row.license_plate} wurde nicht gefunden.`,
                                    );
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
                                    abortRow(
                                        row,
                                        `Fahrzeug ${row.license_plate} konnte nicht aktualisiert werden.`,
                                    );
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
                                        !hasCurrentSheet,
                                    );
                                    if (createdDriver) {
                                        result.created_drivers += 1;
                                    }
                                }

                                result.updated_vehicles += 1;
                            } else {
                                result.skipped_rows += 1;
                            }

                            continue;
                        }

                        if (!row.driver_name || !row.license_plate) {
                            result.skipped_rows += 1;
                            continue;
                        }

                        const vehicleId = findVehicleIdByPlate(
                            companyId,
                            row.license_plate,
                        );
                        if (vehicleId === undefined) {
                            abortRow(
                                row,
                                `Kennzeichen ${row.license_plate} wurde nicht gefunden.`,
                            );
                        }

                        const createdDriver = !driverExists(
                            companyId,
                            row.driver_name,
                        );
                        const driverId = DriverModel.upsert(
                            companyId,
                            row.driver_name,
                        );
                        if (createdDriver) {
                            result.created_drivers += 1;
                        }

                        DriverModel.assignVehicle(
                            driverId,
                            vehicleId,
                            companyId,
                        );

                        if (kind === "eligibility") {
                            result.assigned_eligibility += 1;
                            continue;
                        }

                        DriverModel.setCurrentVehicle(
                            driverId,
                            vehicleId,
                            companyId,
                        );
                        result.set_current += 1;
                    }
                }
            });
        } catch (error) {
            if (
                error instanceof ConflictError &&
                error.message.includes("nichts übernommen")
            ) {
                throw error;
            }

            if (error instanceof NotFoundError) {
                throw error;
            }

            const detail = isUniqueConstraintError(error)
                ? "Kennzeichen ist bereits vergeben."
                : error instanceof Error
                  ? error.message
                  : "Unbekannter Fehler beim Import.";

            throw new ConflictError(
                `Import abgebrochen: ${detail} Es wurde nichts übernommen.`,
                {},
            );
        }

        deleteImportPreview(previewId);
        return result;
    }
}

export { VEHICLE_STATUSES as importVehicleStatuses };
