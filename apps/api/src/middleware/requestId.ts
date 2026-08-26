import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export const requestId: RequestHandler = (req, res, next) => {
    const incoming = req.headers["x-request-id"];
    const id = typeof incoming === "string" && incoming ? incoming : randomUUID();

    req.id = id;
    res.setHeader("X-Request-Id", id);
    next();
};
