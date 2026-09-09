import { z } from "zod";
import { VEHICLE_STATUSES, type VehicleStatus } from "./vehicle";

export const IMPORT_COLUMN_TARGETS = [
    "license_plate",
    "fuel_level",
    "status",
    "driver_name",
    "ignore",
] as const;

export type ImportColumnTarget = (typeof IMPORT_COLUMN_TARGETS)[number];

export const IMPORT_ROW_ACTIONS = ["create", "update", "skip"] as const;

export type ImportRowAction = (typeof IMPORT_ROW_ACTIONS)[number];

export type ImportColumnMapping = Partial<Record<string, ImportColumnTarget>>;

export type ImportStatusMapping = Partial<Record<string, VehicleStatus>>;

export type ImportRowIssue = {
    level: "error" | "warning";
    code: string;
    message: string;
};

export type ImportPreviewRow = {
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

export type ImportPreviewResponse = {
    preview_id: string;
    columns: string[];
    suggested_mapping: ImportColumnMapping;
    unmapped_status_values: string[];
    rows: ImportPreviewRow[];
    counts: ImportPreviewCounts;
    can_commit: boolean;
};

export type ImportCommitResult = {
    created_vehicles: number;
    updated_vehicles: number;
    created_drivers: number;
    skipped_rows: number;
    failed_rows: number;
    errors: Array<{ row_index: number; message: string }>;
};

const columnTargetSchema = z.enum(IMPORT_COLUMN_TARGETS);

const columnMappingSchema = z.record(z.string(), columnTargetSchema);

const statusMappingSchema = z.record(
    z.string(),
    z.enum(VEHICLE_STATUSES),
);

const importPreviewInputSchema = z
    .object({
        csv: z.string().optional(),
        xlsx: z.string().optional(),
        column_mapping: columnMappingSchema.optional(),
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
    z.string().regex(/^\d+$/),
    z.enum(IMPORT_ROW_ACTIONS),
);

const importCommitInputSchema = z.object({
    preview_id: z
        .string({ error: "Vorschau-ID fehlt." })
        .min(1, "Vorschau-ID fehlt."),
    row_actions: rowActionsSchema.optional(),
});

export type ImportPreviewInput = {
    csv?: string;
    xlsx?: string;
    column_mapping?: ImportColumnMapping;
    status_mapping?: ImportStatusMapping;
};

export type ImportCommitInput = {
    preview_id: string;
    row_actions?: Record<string, ImportRowAction>;
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
        status_mapping: parsed.status_mapping as
            | ImportStatusMapping
            | undefined,
    };
}

export function parseImportCommitInput(body: unknown): ImportCommitInput {
    return importCommitInputSchema.parse(body) as ImportCommitInput;
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
