import { ApiError, notifyUnauthorized } from "./client";

const FILES = {
    vehicles: "fahrzeuge.csv",
    alerts: "warnungen.csv",
    trips: "fahrten.csv",
    period: "zeitraum.csv",
} as const;

export type ExportKind = keyof typeof FILES;

export async function downloadExport(kind: ExportKind): Promise<void> {
    const response = await fetch(`/api/export/${kind}`, {
        credentials: "include",
    });

    if (response.status === 401) {
        notifyUnauthorized();
        throw new ApiError("Anmeldung erforderlich.", 401, undefined, "UNAUTHORIZED");
    }

    if (!response.ok) {
        let message = "Export ist fehlgeschlagen.";
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
            const body = (await response.json()) as { error?: string };
            if (body.error) {
                message = body.error;
            }
        }

        throw new ApiError(message, response.status);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = FILES[kind];
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}
