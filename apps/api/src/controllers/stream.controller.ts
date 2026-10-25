import type { Request, Response } from "express";
import { parseStreamFocus } from "@fleet-live/shared";
import { AppError, BadRequestError, UnauthorizedError } from "../lib/errors";
import { sessionCompany } from "../lib/http";
import { hashToken } from "../lib/tokenHash";
import { SessionModel } from "../models/session.model";
import { VehicleModel } from "../models/vehicle.model";
import { logger } from "../logger";
import { openSseWriter } from "../sse/compression";
import {
    replay,
    setConnectionFocus,
    streamCountForUser,
    subscribe,
    unsubscribe,
} from "../sse/hub";

/** How often an open stream checks that its session still admits it. */
const HEARTBEAT_MS = 15_000;

/**
 * Open streams per person: one per tab, with room to spare. Each stream holds
 * a socket and a compressor on the server, so the number has a ceiling.
 */
const STREAMS_PER_USER_MAX = 20;

export function streamEvents(req: Request, res: Response) {
    const companyId = sessionCompany(req);
    const auth = req.auth;
    const userId = req.user?.id;

    if (!auth || userId === undefined) {
        throw new UnauthorizedError();
    }

    if (streamCountForUser(userId) >= STREAMS_PER_USER_MAX) {
        throw new AppError(
            429,
            "STREAM_LIMIT",
            "Zu viele offene Live-Verbindungen. Schließe ein paar Tabs.",
        );
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    // Brotli oder gzip, wenn der Browser es annimmt; jedes Ereignis wird sofort
    // durchgespült (siehe sse/compression.ts), der allgemeine Middleware ist
    // für diesen Strom ausgenommen.
    const writer = openSseWriter(res, req.headers["accept-encoding"]);
    res.flushHeaders();

    let closed = false;
    const timer: { heartbeat?: NodeJS.Timeout } = {};

    const onClose = () => {
        if (closed) {
            return;
        }

        closed = true;
        clearInterval(timer.heartbeat);
        unsubscribe(writer);
        // Gibt den Kompressor frei; für die unkomprimierte Antwort ist es harmlos.
        writer.end();
        logger.info(
            { companyId, connectionId },
            "sse connection closed",
        );
    };

    // The stream belongs to this session in this company: the hub ends it when
    // the session ends or changes, and the heartbeat checks it again.
    const connectionId = subscribe(writer, companyId, {
        userId,
        tokenHash: hashToken(auth.token),
        onEnd: onClose,
    });
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

    timer.heartbeat = setInterval(() => {
        // An expired session, or one the company rules no longer admit, ends
        // the stream; the check does not keep an idle session alive.
        const session = SessionModel.find(auth.token, false);

        if (
            !session ||
            session.user.company_id !== companyId ||
            session.user.id !== userId
        ) {
            onClose();
            return;
        }

        writer.write("event: heartbeat\ndata: {}\n\n");
    }, HEARTBEAT_MS);

    timer.heartbeat.unref?.();

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
        req.user?.id,
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
