import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

/** An id from a proxy is kept only when it is short and plain; it goes into logs and a header. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

export const requestId: RequestHandler = (req, res, next) => {
    const incoming = req.headers["x-request-id"];
    const id = typeof incoming === "string" && SAFE_ID.test(incoming) ? incoming : randomUUID();

    req.id = id;
    res.setHeader("X-Request-Id", id);
    next();
};
