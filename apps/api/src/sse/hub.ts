import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { STREAM_FOCUS_MAX_IDS } from "@fleet-live/shared";

type SseEvent = {
    id: number;
    event: string;
    data: unknown;
    companyId: number;
};

type Client = {
    res: Response;
    focusIds: number[];
    companyId: number;
};

const MAX_BUFFER = 64;
const clients = new Map<string, Client>();
const buffer: SseEvent[] = [];
let nextId = 1;

function formatSse(event: SseEvent): string {
    return `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
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

function writeToClient(client: Client, event: SseEvent) {
    const payload = payloadForClient(event, client);

    if (!payload) {
        return;
    }

    const ok = client.res.write(formatSse(payload));

    if (!ok) {
        client.res.once("drain", () => undefined);
    }
}

function findClient(res: Response): Client | undefined {
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

export function subscribe(res: Response, companyId: number): string {
    const connectionId = randomUUID();
    clients.set(connectionId, { res, focusIds: [], companyId });
    return connectionId;
}

export function replay(res: Response, lastEventId: number) {
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

export function unsubscribe(res: Response) {
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
): number | false {
    const client = clients.get(connectionId);

    if (!client || client.companyId !== companyId) {
        return false;
    }

    const unique = sanitizeIds(ids);
    client.focusIds = unique;
    return unique.length;
}

export function getFocusUnion(): number[] {
    const seen = new Set<number>();
    const ids: number[] = [];

    for (const client of clients.values()) {
        for (const id of client.focusIds) {
            if (seen.has(id)) {
                continue;
            }

            seen.add(id);
            ids.push(id);
        }
    }

    return ids;
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
