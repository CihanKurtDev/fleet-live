import type { Request, Response } from "express";
import { parseStreamFocus } from "@fleet-live/shared";
import { BadRequestError } from "../lib/errors";
import {
    replay,
    setConnectionFocus,
    subscribe,
    unsubscribe,
} from "../sse/hub";

export function streamEvents(req: Request, res: Response) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write("retry: 3000\n\n");

    const connectionId = subscribe(res);
    res.write(
        `event: connected\ndata: ${JSON.stringify({ connection_id: connectionId })}\n\n`,
    );

    const rawId = req.headers["last-event-id"];
    const lastEventId =
        typeof rawId === "string" ? Number(rawId) : Number.NaN;

    replay(res, Number.isFinite(lastEventId) ? lastEventId : 0);

    const heartbeat = setInterval(() => {
        res.write(":heartbeat\n\n");
    }, 15_000);

    heartbeat.unref?.();

    const onClose = () => {
        clearInterval(heartbeat);
        unsubscribe(res);
    };

    req.on("close", onClose);
    req.on("end", onClose);
}

export function setStreamFocus(req: Request, res: Response) {
    const { connection_id, ids } = parseStreamFocus(req.body);
    const count = setConnectionFocus(connection_id, ids);

    if (count === false) {
        throw new BadRequestError("Unbekannte Verbindung.");
    }

    res.json({ ok: true, count });
}
