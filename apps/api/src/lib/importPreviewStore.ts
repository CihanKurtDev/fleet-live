import { randomUUID } from "node:crypto";
import type {
    ImportColumnMapping,
    ImportPreviewRow,
    ImportStatusMapping,
} from "@fleet-live/shared";

const PREVIEW_TTL_MS = 30 * 60 * 1000;

export type StoredImportPreview = {
    companyId: number;
    userId: number;
    createdAt: number;
    rows: ImportPreviewRow[];
    columnMapping: ImportColumnMapping;
    statusMapping: ImportStatusMapping;
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
    preview: Omit<StoredImportPreview, "createdAt">,
): string {
    purgeExpired();
    const previewId = randomUUID();
    store.set(previewId, { ...preview, createdAt: Date.now() });
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

export function deleteImportPreview(previewId: string): void {
    store.delete(previewId);
}

export function resetImportPreviewStoreForTests(): void {
    store.clear();
}
