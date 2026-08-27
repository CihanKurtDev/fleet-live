import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { STREAM_FOCUS_MAX_IDS } from "@fleet-live/shared";

type SseEvent = {
    id: number;
    event: string;
    data: unknown;
};

type Client = {
    res: Response;
    focusIds: number[];
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

export function broadcast(event: string, data: unknown) {
    const payload: SseEvent = { id: nextId++, event, data };
    buffer.push(payload);

    if (buffer.length > MAX_BUFFER) {
        buffer.shift();
    }

    const chunk = formatSse(payload);

    for (const client of clients.values()) {
        const ok = client.res.write(chunk);

        if (!ok) {
            client.res.once("drain", () => undefined);
        }
    }
}

export function subscribe(res: Response): string {
    const connectionId = randomUUID();
    clients.set(connectionId, { res, focusIds: [] });
    return connectionId;
}

export function replay(res: Response, lastEventId: number) {
    if (lastEventId <= 0) {
        return;
    }

    for (const event of buffer) {
        if (event.id > lastEventId) {
            res.write(formatSse(event));
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
): number | false {
    const client = clients.get(connectionId);

    if (!client) {
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
}

export function connectedClientCount() {
    return clients.size;
}
