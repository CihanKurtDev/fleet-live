const sources = new Map<string, number[]>();
let publishTimer: ReturnType<typeof setTimeout> | undefined;
let connectionId: string | null = null;

function collectIds(): number[] {
    const ids = new Set<number>();

    for (const group of sources.values()) {
        for (const id of group) {
            ids.add(id);
        }
    }

    return [...ids];
}

function publish() {
    if (!connectionId) {
        return;
    }

    const ids = collectIds();

    void fetch("/api/stream/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: connectionId, ids }),
    }).catch(() => undefined);
}

function schedulePublish() {
    if (publishTimer !== undefined) {
        clearTimeout(publishTimer);
    }

    publishTimer = setTimeout(() => {
        publishTimer = undefined;
        publish();
    }, 50);
}

/** Setzt die SSE-Verbindungs-ID. Focus-POSTs warten, bis sie da ist. */
export function setStreamConnection(id: string | null) {
    connectionId = id;

    if (id) {
        schedulePublish();
    }
}

/** Meldet, welche Fahrzeuge der Simulator bevorzugt ticken soll. */
export function setTelemetryFocus(source: string, ids: number[]) {
    if (ids.length === 0) {
        sources.delete(source);
    } else {
        sources.set(source, ids);
    }

    schedulePublish();
}

export function clearTelemetryFocus(source: string) {
    if (!sources.has(source)) {
        return;
    }

    sources.delete(source);
    schedulePublish();
}
