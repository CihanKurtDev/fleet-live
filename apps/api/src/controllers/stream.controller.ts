import type { Request, Response } from "express";
import { setFocusIds } from "../sse/focus";
import { subscribe, unsubscribe } from "../sse/hub";

export function streamEvents(req: Request, res: Response) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write("retry: 3000\n\n");
    res.write("event: connected\ndata: {}\n\n");

    const rawId = req.headers["last-event-id"];
    const lastEventId =
        typeof rawId === "string" ? Number(rawId) : Number.NaN;

    subscribe(res, Number.isFinite(lastEventId) ? lastEventId : 0);

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
    const rawIds = (req.body as { ids?: unknown })?.ids;
    const ids = Array.isArray(rawIds)
        ? rawIds.filter(
              (value): value is number =>
                  typeof value === "number" && Number.isInteger(value) && value > 0,
          )
        : [];

    setFocusIds(ids);
    res.json({ ok: true, count: ids.length });
}
