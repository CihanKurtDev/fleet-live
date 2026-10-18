import type { Request, Response } from "express";
import { parseStreamFocus } from "@fleet-live/shared";
import { BadRequestError } from "../lib/errors";
import { sessionCompany } from "../lib/http";
import { VehicleModel } from "../models/vehicle.model";
import { logger } from "../logger";
import { openSseWriter } from "../sse/compression";
import {
    replay,
    setConnectionFocus,
    subscribe,
    unsubscribe,
} from "../sse/hub";

export function streamEvents(req: Request, res: Response) {
    const companyId = sessionCompany(req);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    // Brotli oder gzip, wenn der Browser es annimmt; jedes Ereignis wird sofort
    // durchgespült (siehe sse/compression.ts), der allgemeine Middleware ist
    // für diesen Strom ausgenommen.
    const writer = openSseWriter(res, req.headers["accept-encoding"]);
    res.flushHeaders();

    const connectionId = subscribe(writer, companyId);
    logger.info(
        { companyId, connectionId },
        "sse connection opened",
    );
    // In einem Zug: so kommt es bei jedem Client als ein Stück an, mit und ohne Kompression.
    writer.write(
        `retry: 3000\n\nevent: connected\ndata: ${JSON.stringify({ connection_id: connectionId })}\n\n`,
    );

    const rawId = req.headers["last-event-id"];
    const lastEventId =
        typeof rawId === "string" ? Number(rawId) : Number.NaN;

    replay(writer, Number.isFinite(lastEventId) ? lastEventId : 0);

    const heartbeat = setInterval(() => {
        writer.write("event: heartbeat\ndata: {}\n\n");
    }, 15_000);

    heartbeat.unref?.();

    const onClose = () => {
        clearInterval(heartbeat);
        unsubscribe(writer);
        // Gibt den Kompressor frei; für die unkomprimierte Antwort ist es harmlos.
        writer.end();
        logger.info(
            { companyId, connectionId },
            "sse connection closed",
        );
    };

    req.on("close", onClose);
    req.on("end", onClose);
}

export function setStreamFocus(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const { connection_id, ids } = parseStreamFocus(req.body);
    const owned = VehicleModel.ownedIds(ids, companyId);
    const count = setConnectionFocus(
        connection_id,
        owned,
        companyId,
    );

    if (count === false) {
        throw new BadRequestError("Unbekannte Verbindung.");
    }

    logger.debug(
        { companyId, connectionId: connection_id, requested: ids.length, focused: count },
        "sse focus updated",
    );
    res.json({ ok: true, count });
}
