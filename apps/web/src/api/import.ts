import type {
    ImportColumnMapping,
    ImportCommitInput,
    ImportCommitResult,
    ImportPreviewInput,
    ImportPreviewOutcome,
    ImportPreviewResponse,
    ImportPreviewRowsQuery,
    ImportPreviewRowsResponse,
    ImportRowAction,
    ImportRunListResponse,
    ImportStatusMapping,
} from "@fleet-live/shared";
import { request } from "./client";

const IMPORT_TIMEOUT_MS = 120_000;

export function previewImport(input: ImportPreviewInput) {
    return request<{ data: ImportPreviewResponse }>("/api/import/preview", {
        method: "POST",
        body: input,
        timeoutMs: IMPORT_TIMEOUT_MS,
    });
}

export function listImportPreviewRows(
    previewId: string,
    query: Partial<ImportPreviewRowsQuery> = {},
) {
    const params = new URLSearchParams();
    if (query.page) {
        params.set("page", String(query.page));
    }
    if (query.limit) {
        params.set("limit", String(query.limit));
    }
    if (query.sheet_kind) {
        params.set("sheet_kind", query.sheet_kind);
    }
    if (query.status) {
        params.set("status", query.status);
    }
    if (query.q) {
        params.set("q", query.q);
    }

    const path = `/api/import/preview/${previewId}/rows?${params.toString()}`;

    return request<ImportPreviewRowsResponse>(path, {
        timeoutMs: IMPORT_TIMEOUT_MS,
    });
}

export function patchImportPreviewActions(
    previewId: string,
    rowActions: Record<string, ImportRowAction>,
) {
    return request<{ data: ImportPreviewOutcome }>(
        `/api/import/preview/${previewId}/actions`,
        {
            method: "PATCH",
            body: { row_actions: rowActions },
            timeoutMs: IMPORT_TIMEOUT_MS,
        },
    );
}

export function markImportExistingUpdate(previewId: string) {
    return request<{ data: ImportPreviewOutcome }>(
        `/api/import/preview/${previewId}/mark-existing`,
        {
            method: "POST",
            body: {},
            timeoutMs: IMPORT_TIMEOUT_MS,
        },
    );
}

export function commitImport(input: ImportCommitInput) {
    return request<{ data: ImportCommitResult }>("/api/import/commit", {
        method: "POST",
        body: input,
        timeoutMs: IMPORT_TIMEOUT_MS,
    });
}

export function listImportRuns() {
    return request<ImportRunListResponse>("/api/import/runs?limit=10");
}

export type {
    ImportColumnMapping,
    ImportCommitResult,
    ImportPreviewOutcome,
    ImportPreviewResponse,
    ImportRowAction,
    ImportStatusMapping,
};
