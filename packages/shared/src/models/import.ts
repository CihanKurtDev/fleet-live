import { z } from "zod";
import { emptyToUndefined } from "./queryPreprocess";
import { VEHICLE_STATUSES, type VehicleStatus } from "./vehicle";
import { VEHICLE_PAGE_LIMITS } from "./vehicleQuery";

export const IMPORT_COLUMN_TARGETS = [
    "license_plate",
    "fuel_level",
    "status",
    "driver_name",
    "ignore",
] as const;

export type ImportColumnTarget = (typeof IMPORT_COLUMN_TARGETS)[number];

export const IMPORT_SHEET_KINDS = [
    "vehicles",
    "drivers",
    "eligibility",
    "current",
] as const;

export type ImportSheetKind = (typeof IMPORT_SHEET_KINDS)[number];

export const IMPORT_ROW_ACTIONS = ["create", "update", "skip"] as const;

export type ImportRowAction = (typeof IMPORT_ROW_ACTIONS)[number];

export type ImportColumnMapping = Partial<Record<string, ImportColumnTarget>>;

export type ImportStatusMapping = Partial<Record<string, VehicleStatus>>;

export type ImportSheetMappings = Partial<
    Record<ImportSheetKind, ImportColumnMapping>
>;

export type ImportRowIssue = {
    level: "error" | "warning";
    code: string;
    message: string;
};

export type ImportPreviewRow = {
    sheet_kind: ImportSheetKind;
    row_index: number;
    license_plate: string | null;
    fuel_level: number | null;
    status: VehicleStatus | null;
    driver_name: string | null;
    default_action: ImportRowAction;
    issues: ImportRowIssue[];
};

export type ImportPreviewCounts = {
    total_rows: number;
    to_create: number;
    to_update: number;
    to_skip: number;
    errors: number;
    warnings: number;
};

export type ImportPreviewSheet = {
    kind: ImportSheetKind;
    name: string;
    columns: string[];
    suggested_mapping: ImportColumnMapping;
    unmapped_status_values: string[];
    rows: ImportPreviewRow[];
    counts: ImportPreviewCounts;
};

export type ImportPreviewResponse = {
    preview_id: string;
    sheets: ImportPreviewSheet[];
    columns: string[];
    suggested_mapping: ImportColumnMapping;
    unmapped_status_values: string[];
    rows: ImportPreviewRow[];
    counts: ImportPreviewCounts;
    can_commit: boolean;
    profile_applied: boolean;
};

export const IMPORT_SOURCES = ["csv", "xlsx"] as const;

export type ImportSource = (typeof IMPORT_SOURCES)[number];

export type ImportMappingProfile = {
    sheet_mappings: ImportSheetMappings;
    status_mapping: ImportStatusMapping;
    updated_at: string;
};

export type ImportRun = {
    id: number;
    created_at: string;
    source: ImportSource;
    user_name: string;
    created_vehicles: number;
    updated_vehicles: number;
    created_drivers: number;
    assigned_eligibility: number;
    set_current: number;
    skipped_rows: number;
    failed_rows: number;
    warning_count: number;
};

export type ImportRunListResponse = {
    data: ImportRun[];
    meta: {
        page: number;
        limit: number;
        total: number;
        pageCount: number;
    };
};

export type ImportCommitResult = {
    created_vehicles: number;
    updated_vehicles: number;
    created_drivers: number;
    assigned_eligibility: number;
    set_current: number;
    skipped_rows: number;
    failed_rows: number;
    errors: Array<{ row_index: number; message: string }>;
    profile_saved: boolean;
};

const columnTargetSchema = z.enum(IMPORT_COLUMN_TARGETS);

const columnMappingSchema = z.record(z.string(), columnTargetSchema);

const statusMappingSchema = z.record(
    z.string(),
    z.enum(VEHICLE_STATUSES),
);

const sheetMappingsSchema = z.object({
    vehicles: columnMappingSchema.optional(),
    drivers: columnMappingSchema.optional(),
    eligibility: columnMappingSchema.optional(),
    current: columnMappingSchema.optional(),
});

const importPreviewInputSchema = z
    .object({
        csv: z.string().optional(),
        xlsx: z.string().optional(),
        column_mapping: columnMappingSchema.optional(),
        sheet_mappings: sheetMappingsSchema.optional(),
        status_mapping: statusMappingSchema.optional(),
    })
    .refine(
        (value) => {
            const csv = value.csv?.trim() ?? "";
            const xlsx = value.xlsx?.trim() ?? "";
            return (csv.length > 0) !== (xlsx.length > 0);
        },
        "Bitte CSV- oder Excel-Inhalt senden.",
    );

const rowActionsSchema = z.record(
    z.string().min(1),
    z.enum(IMPORT_ROW_ACTIONS),
);

const importCommitInputSchema = z.object({
    preview_id: z
        .string({ error: "Vorschau-ID fehlt." })
        .min(1, "Vorschau-ID fehlt."),
    row_actions: rowActionsSchema.optional(),
    save_profile: z.boolean().optional(),
});

const importProfileInputSchema = z.object({
    sheet_mappings: sheetMappingsSchema.default({}),
    status_mapping: statusMappingSchema.default({}),
});

const importRunListQuerySchema = z.object({
    page: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number({ error: "Seite muss eine Zahl sein." })
            .int("Seite muss eine ganze Zahl sein.")
            .min(1, "Seite muss mindestens 1 sein.")
            .default(1),
    ),
    limit: z.preprocess(
        emptyToUndefined,
        z.coerce
            .number({ error: "Limit muss eine Zahl sein." })
            .int("Limit muss eine ganze Zahl sein.")
            .refine(
                (value) =>
                    (VEHICLE_PAGE_LIMITS as readonly number[]).includes(value),
                "Limit muss 10, 25, 50 oder 100 sein.",
            )
            .default(10),
    ),
});

export type ImportPreviewInput = {
    csv?: string;
    xlsx?: string;
    column_mapping?: ImportColumnMapping;
    sheet_mappings?: ImportSheetMappings;
    status_mapping?: ImportStatusMapping;
};

export type ImportCommitInput = {
    preview_id: string;
    row_actions?: Record<string, ImportRowAction>;
    save_profile?: boolean;
};

export type ImportProfileInput = {
    sheet_mappings: ImportSheetMappings;
    status_mapping: ImportStatusMapping;
};

export type ImportRunListQuery = {
    page: number;
    limit: number;
};

export function parseImportPreviewInput(body: unknown): ImportPreviewInput {
    const parsed = importPreviewInputSchema.parse(body);
    const csv = parsed.csv?.trim() ?? "";
    const xlsx = parsed.xlsx?.trim() ?? "";

    return {
        ...(csv ? { csv } : {}),
        ...(xlsx ? { xlsx } : {}),
        column_mapping: parsed.column_mapping as
            | ImportColumnMapping
            | undefined,
        sheet_mappings: parsed.sheet_mappings as
            | ImportSheetMappings
            | undefined,
        status_mapping: parsed.status_mapping as
            | ImportStatusMapping
            | undefined,
    };
}

export function parseImportCommitInput(body: unknown): ImportCommitInput {
    const parsed = importCommitInputSchema.parse(body);

    return {
        preview_id: parsed.preview_id,
        row_actions: parsed.row_actions as
            | Record<string, ImportRowAction>
            | undefined,
        save_profile: parsed.save_profile ?? true,
    };
}

export function parseImportProfileInput(body: unknown): ImportProfileInput {
    const parsed = importProfileInputSchema.parse(body);

    return {
        sheet_mappings: parsed.sheet_mappings as ImportSheetMappings,
        status_mapping: parsed.status_mapping as ImportStatusMapping,
    };
}

export function parseImportRunListQuery(input: unknown): ImportRunListQuery {
    return importRunListQuerySchema.parse(input);
}

export function isImportColumnTarget(
    value: unknown,
): value is ImportColumnTarget {
    return (
        typeof value === "string" &&
        (IMPORT_COLUMN_TARGETS as readonly string[]).includes(value)
    );
}

export function isImportRowAction(value: unknown): value is ImportRowAction {
    return (
        typeof value === "string" &&
        (IMPORT_ROW_ACTIONS as readonly string[]).includes(value)
    );
}

export function isImportSheetKind(value: unknown): value is ImportSheetKind {
    return (
        typeof value === "string" &&
        (IMPORT_SHEET_KINDS as readonly string[]).includes(value)
    );
}

export function importActionKey(
    kind: ImportSheetKind,
    rowIndex: number,
): string {
    return `${kind}:${rowIndex}`;
}

export function importRequiredTargets(
    kind: ImportSheetKind,
): ImportColumnTarget[] {
    if (kind === "drivers") {
        return ["driver_name"];
    }

    if (kind === "eligibility" || kind === "current") {
        return ["driver_name", "license_plate"];
    }

    return ["license_plate"];
}
