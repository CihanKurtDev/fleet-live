import { randomUUID } from "node:crypto";
import type {
    ImportColumnMapping,
    ImportPreviewRow,
    ImportRowAction,
    ImportSheetMappings,
    ImportSource,
    ImportStatusMapping,
} from "@fleet-live/shared";

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const PREVIEWS_PER_USER_MAX = 3;
const PREVIEWS_TOTAL_MAX = 100;

export type StoredImportPreview = {
    companyId: number;
    userId: number;
    createdAt: number;
    source: ImportSource;
    rows: ImportPreviewRow[];
    sheetMappings: ImportSheetMappings;
    columnMapping: ImportColumnMapping;
    statusMapping: ImportStatusMapping;
    warningCount: number;
    rowActions: Record<string, ImportRowAction>;
};

const store = new Map<string, StoredImportPreview>();

function purgeExpired(): void {
    const now = Date.now();

    for (const [id, preview] of store) {
        if (now - preview.createdAt > PREVIEW_TTL_MS) {
            store.delete(id);
        }
    }
}

export function saveImportPreview(
    preview: Omit<StoredImportPreview, "createdAt" | "rowActions"> & {
        rowActions?: Record<string, ImportRowAction>;
    },
): string {
    purgeExpired();

    const owned = [...store.entries()]
        .filter(
            ([, stored]) =>
                stored.companyId === preview.companyId &&
                stored.userId === preview.userId,
        )
        .sort((left, right) => left[1].createdAt - right[1].createdAt);
    while (owned.length >= PREVIEWS_PER_USER_MAX) {
        const oldest = owned.shift();
        if (oldest) {
            store.delete(oldest[0]);
        }
    }

    if (store.size >= PREVIEWS_TOTAL_MAX) {
        const oldest = [...store.entries()].sort(
            (left, right) => left[1].createdAt - right[1].createdAt,
        )[0];
        if (oldest) {
            store.delete(oldest[0]);
        }
    }

    const previewId = randomUUID();
    store.set(previewId, {
        ...preview,
        rowActions: preview.rowActions ?? {},
        createdAt: Date.now(),
    });
    return previewId;
}

export function getImportPreview(
    previewId: string,
    companyId: number,
): StoredImportPreview | undefined {
    purgeExpired();
    const preview = store.get(previewId);

    if (!preview || preview.companyId !== companyId) {
        return undefined;
    }

    return preview;
}

export function patchImportPreviewActions(
    previewId: string,
    companyId: number,
    rowActions: Record<string, ImportRowAction>,
): StoredImportPreview | undefined {
    const preview = getImportPreview(previewId, companyId);
    if (!preview) {
        return undefined;
    }

    preview.rowActions = { ...preview.rowActions, ...rowActions };
    return preview;
}

export function deleteImportPreview(previewId: string): void {
    store.delete(previewId);
}

export function resetImportPreviewStoreForTests(): void {
    store.clear();
}
