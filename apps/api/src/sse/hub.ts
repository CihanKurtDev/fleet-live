import type { Response } from "express";
import { clearFocusIds } from "./focus";

type SseEvent = {
    id: number;
    event: string;
    data: unknown;
};

const MAX_BUFFER = 64;
const clients = new Set<Response>();
const buffer: SseEvent[] = [];
let nextId = 1;

function formatSse(event: SseEvent): string {
    return `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export function broadcast(event: string, data: unknown) {
    const payload: SseEvent = { id: nextId++, event, data };
    buffer.push(payload);

    if (buffer.length > MAX_BUFFER) {
        buffer.shift();
    }

    const chunk = formatSse(payload);

    for (const client of clients) {
        const ok = client.write(chunk);

        if (!ok) {
            client.once("drain", () => undefined);
        }
    }
}

export function subscribe(res: Response, lastEventId: number) {
    clients.add(res);

    if (lastEventId > 0) {
        for (const event of buffer) {
            if (event.id > lastEventId) {
                res.write(formatSse(event));
            }
        }
    }
}

export function unsubscribe(res: Response) {
    clients.delete(res);

    if (clients.size === 0) {
        clearFocusIds();
    }
}

export function closeAllSseClients() {
    for (const client of clients) {
        client.end();
    }

    clients.clear();
    clearFocusIds();
}

export function connectedClientCount() {
    return clients.size;
}
