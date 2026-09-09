import type {
    ImportColumnMapping,
    ImportColumnTarget,
    ImportSheetKind,
} from "@fleet-live/shared";

const SHEET_NAME_HINTS: Array<{
    kind: ImportSheetKind;
    pattern: RegExp;
}> = [
    { kind: "eligibility", pattern: /eignung|eligible|berechtigt|zuordnung/i },
    { kind: "current", pattern: /aktuell|current|besatzung|eingesetzt/i },
    { kind: "drivers", pattern: /fahrer|driver|personal|roster/i },
    { kind: "vehicles", pattern: /fahrzeug|vehicle|flotte|kennzeichen/i },
];

const VEHICLE_COLUMN_HINTS: Array<{
    pattern: RegExp;
    target: ImportColumnTarget;
}> = [
    { pattern: /kennzeichen|license|plate|nummer/i, target: "license_plate" },
    { pattern: /tank|fuel|kraftstoff/i, target: "fuel_level" },
    { pattern: /status|zustand|state/i, target: "status" },
    { pattern: /fahrer|driver|lenker/i, target: "driver_name" },
];

const NAME_COLUMN_HINTS: Array<{
    pattern: RegExp;
    target: ImportColumnTarget;
}> = [
    { pattern: /kennzeichen|license|plate|fahrzeug/i, target: "license_plate" },
    { pattern: /fahrer|driver|lenker|name/i, target: "driver_name" },
];

export function classifySheetName(name: string): ImportSheetKind | null {
    for (const hint of SHEET_NAME_HINTS) {
        if (hint.pattern.test(name)) {
            return hint.kind;
        }
    }

    return null;
}

export function assignSheetKinds(
    names: string[],
): Array<ImportSheetKind | null> {
    const used = new Set<ImportSheetKind>();
    const kinds = names.map((name) => {
        const kind = classifySheetName(name);
        if (kind && !used.has(kind)) {
            used.add(kind);
            return kind;
        }

        return null;
    });

    if (!used.has("vehicles")) {
        const fallback = kinds.findIndex((kind) => kind === null);
        if (fallback >= 0) {
            kinds[fallback] = "vehicles";
            used.add("vehicles");
        }
    }

    return kinds;
}

export function suggestColumnMapping(
    kind: ImportSheetKind,
    columns: string[],
): ImportColumnMapping {
    const hints =
        kind === "vehicles" ? VEHICLE_COLUMN_HINTS : NAME_COLUMN_HINTS;
    const mapping: ImportColumnMapping = {};
    const usedTargets = new Set<ImportColumnTarget>();

    for (const column of columns) {
        for (const hint of hints) {
            if (usedTargets.has(hint.target)) {
                continue;
            }

            if (hint.pattern.test(column)) {
                mapping[column] = hint.target;
                usedTargets.add(hint.target);
                break;
            }
        }

        if (!(column in mapping)) {
            mapping[column] = "ignore";
        }
    }

    return mapping;
}
