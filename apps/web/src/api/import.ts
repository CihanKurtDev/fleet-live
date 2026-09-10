import type {
    ImportColumnMapping,
    ImportCommitInput,
    ImportCommitResult,
    ImportPreviewInput,
    ImportPreviewResponse,
    ImportRowAction,
    ImportRunListResponse,
    ImportStatusMapping,
} from "@fleet-live/shared";
import { request } from "./client";

export function previewImport(input: ImportPreviewInput) {
    return request<{ data: ImportPreviewResponse }>("/api/import/preview", {
        method: "POST",
        body: input,
        timeoutMs: 30_000,
    });
}

export function commitImport(input: ImportCommitInput) {
    return request<{ data: ImportCommitResult }>("/api/import/commit", {
        method: "POST",
        body: input,
        timeoutMs: 30_000,
    });
}

export function listImportRuns() {
    return request<ImportRunListResponse>("/api/import/runs?limit=10");
}

export type {
    ImportColumnMapping,
    ImportCommitResult,
    ImportPreviewResponse,
    ImportRowAction,
    ImportStatusMapping,
};
