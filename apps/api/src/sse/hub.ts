import { randomUUID } from "node:crypto";
import { hashToken } from "../lib/tokenHash";
import type { SseWriter } from "./compression";
import {
    STREAM_FOCUS_MAX_IDS,
    compactTelemetryPatches,
} from "@fleet-live/shared";

type SseEvent = {
    id: number;
    event: string;
    data: unknown;
    companyId: number;
};

type PendingPatch = { id: number; path_delta?: string; path_reset?: true } & Record<
    string,
    unknown
>;

/** Who a stream belongs to: the session that opened it. */
export type StreamOwner = {
    userId: number;
    /** sha256 of the session token, like the `sessions` table. */
    tokenHash: string;
    /** Ends the response and its timers; called once when the hub drops the stream. */
    onEnd: () => void;
};

type Client = {
    res: SseWriter;
    focusIds: number[];
    companyId: number;
    owner?: StreamOwner;
    /**
     * Neueste Werte je Fahrzeug, solange der Socket des Zuschauers voll ist.
     * Ein langsamer Zuschauer bekommt dann einen zusammengefassten Tick statt
     * einer wachsenden Warteschlange im Speicher des Servers.
     */
    pending: Map<number, PendingPatch>;
    pendingEventId: number;
    waitingForDrain: boolean;
};

const MAX_BUFFER = 64;
const clients = new Map<string, Client>();
const buffer: SseEvent[] = [];
let nextId = 1;

function formatSse(event: SseEvent): string {
    // Telemetrie geht gekürzt auf den Draht (Koordinaten gerundet, gleiches
    // `recorded_at` nur einmal); der Browser stellt es in `parseTelemetryPatches` wieder her.
    const data =
        event.event === "telemetry" && Array.isArray(event.data)
            ? compactTelemetryPatches(event.data)
            : event.data;

    return `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sanitizeIds(ids: number[]): number[] {
    const unique: number[] = [];
    const seen = new Set<number>();

    for (const id of ids) {
        if (!Number.isInteger(id) || id < 1 || seen.has(id)) {
            continue;
        }

        seen.add(id);
        unique.push(id);

        if (unique.length >= STREAM_FOCUS_MAX_IDS) {
            break;
        }
    }

    return unique;
}

function isTelemetryPatch(value: unknown): value is { id: number } {
    return (
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof (value as { id: unknown }).id === "number"
    );
}

function payloadForClient(
    event: SseEvent,
    client: Client,
): SseEvent | null {
    if (event.companyId !== client.companyId) {
        return null;
    }

    if (event.event !== "telemetry") {
        return event;
    }

    if (!Array.isArray(event.data)) {
        return null;
    }

    const allowed = new Set(client.focusIds);
    const patches = event.data.filter(
        (item) => isTelemetryPatch(item) && allowed.has(item.id),
    );

    if (patches.length === 0) {
        return null;
    }

    return { ...event, data: patches };
}

/**
 * Fasst einen Patch mit dem schon wartenden desselben Fahrzeugs zusammen:
 * Position, Tempo usw. gelten wie im neuesten, der Verlauf wird verlustfrei
 * verlängert. `path_delta` ist eine Kette relativ zum letzten Punkt (wie
 * `path = path || ?` in SQL), aufeinanderfolgende Stücke lassen sich also
 * aneinanderhängen. Ein `path_reset` beginnt eine neue Fahrt; was davor
 * wartete, gehört zur alten und entfällt.
 */
function mergePending(pending: Map<number, PendingPatch>, patch: PendingPatch) {
    const earlier = pending.get(patch.id);
    const { path_delta: delta, path_reset: reset, ...latest } = patch;
    const pathDelta = reset
        ? delta
        : `${earlier?.path_delta ?? ""}${delta ?? ""}` || undefined;
    const pathReset = reset ? true : earlier?.path_reset;

    pending.set(patch.id, {
        ...latest,
        id: patch.id,
        ...(pathDelta ? { path_delta: pathDelta } : {}),
        ...(pathReset ? { path_reset: true as const } : {}),
    });
}

function flushPending(client: Client) {
    client.waitingForDrain = false;

    if (client.pending.size === 0) {
        return;
    }

    const data = [...client.pending.values()];
    client.pending.clear();
    client.res.write(
        formatSse({
            id: client.pendingEventId,
            event: "telemetry",
            data,
            companyId: client.companyId,
        }),
    );
}

function writeToClient(client: Client, event: SseEvent) {
    const payload = payloadForClient(event, client);

    if (!payload) {
        return;
    }

    // Der Socket nimmt nichts mehr an: Telemetrie wartet zusammengefasst, bis
    // er wieder frei ist. Kleine Ereignisse (Listen neu laden) gehen sofort.
    if (
        event.event === "telemetry" &&
        (client.res.writableNeedDrain || client.pending.size > 0)
    ) {
        for (const patch of payload.data as PendingPatch[]) {
            mergePending(client.pending, patch);
        }

        client.pendingEventId = event.id;

        if (!client.waitingForDrain) {
            client.waitingForDrain = true;
            client.res.once("drain", () => flushPending(client));
        }

        return;
    }

    client.res.write(formatSse(payload));
}

function findClient(res: SseWriter): Client | undefined {
    for (const client of clients.values()) {
        if (client.res === res) {
            return client;
        }
    }

    return undefined;
}

export function broadcast(
    event: string,
    data: unknown,
    companyId: number,
) {
    const payload: SseEvent = { id: nextId++, event, data, companyId };
    buffer.push(payload);

    if (buffer.length > MAX_BUFFER) {
        buffer.shift();
    }

    for (const client of clients.values()) {
        writeToClient(client, payload);
    }
}

export function subscribe(
    res: SseWriter,
    companyId: number,
    owner?: StreamOwner,
): string {
    const connectionId = randomUUID();
    clients.set(connectionId, {
        res,
        focusIds: [],
        companyId,
        owner,
        pending: new Map(),
        pendingEventId: 0,
        waitingForDrain: false,
    });
    return connectionId;
}

export function replay(res: SseWriter, lastEventId: number) {
    if (lastEventId <= 0) {
        return;
    }

    const client = findClient(res);

    if (!client) {
        return;
    }

    for (const event of buffer) {
        if (event.id > lastEventId) {
            writeToClient(client, event);
        }
    }
}

export function unsubscribe(res: SseWriter) {
    for (const [connectionId, client] of clients) {
        if (client.res === res) {
            clients.delete(connectionId);
            break;
        }
    }
}

export function setConnectionFocus(
    connectionId: string,
    ids: number[],
    companyId: number,
    userId?: number,
): number | false {
    const client = clients.get(connectionId);

    // Only the person whose session opened the stream steers it.
    if (
        !client ||
        client.companyId !== companyId ||
        (client.owner !== undefined && client.owner.userId !== userId)
    ) {
        return false;
    }

    const unique = sanitizeIds(ids);
    client.focusIds = unique;
    return unique.length;
}

/**
 * Ends the open streams that match every given field: one session (`token`),
 * one person (`userId`, optionally all but `exceptToken`), one company.
 * Called when a session ends or changes company, a password is reset or
 * changed, a membership is removed or its role changes, or a company changes
 * its sign-in rules. A browser whose session is still valid reconnects (SSE
 * `retry`); one without gets 401.
 */
export function endStreams(match: {
    token?: string;
    userId?: number;
    companyId?: number;
    exceptToken?: string;
}) {
    const tokenHash = match.token ? hashToken(match.token) : undefined;
    const exceptHash = match.exceptToken ? hashToken(match.exceptToken) : undefined;
    let ended = 0;

    for (const [connectionId, client] of clients) {
        const owner = client.owner;

        if (
            (tokenHash !== undefined && owner?.tokenHash !== tokenHash) ||
            (match.userId !== undefined && owner?.userId !== match.userId) ||
            (match.companyId !== undefined && client.companyId !== match.companyId) ||
            (exceptHash !== undefined && owner?.tokenHash === exceptHash)
        ) {
            continue;
        }

        clients.delete(connectionId);
        ended += 1;

        if (owner) {
            owner.onEnd();
        } else {
            client.res.end();
        }
    }

    return ended;
}

/** Open streams of one person, across their sessions. */
export function streamCountForUser(userId: number): number {
    let count = 0;

    for (const client of clients.values()) {
        if (client.owner?.userId === userId) {
            count += 1;
        }
    }

    return count;
}

export function closeAllSseClients() {
    for (const client of clients.values()) {
        client.res.end();
    }

    clients.clear();
    buffer.length = 0;
}

export function connectedClientCount() {
    return clients.size;
}
