import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { config } from "../config";
import { logger } from "../logger";
import {
    AppError,
    ConflictError,
    isUniqueConstraintError,
} from "../lib/errors";

/** A body that is not JSON or too large is the sender's mistake, not a server error. */
function bodyParserError(err: unknown): AppError | undefined {
    const type = (err as { type?: unknown } | null)?.type;

    if (type === "entity.parse.failed") {
        return new AppError(
            400,
            "BAD_REQUEST",
            "Der Anfrage-Text ist kein gültiges JSON.",
        );
    }

    if (type === "entity.too.large") {
        return new AppError(
            413,
            "PAYLOAD_TOO_LARGE",
            "Der Anfrage-Text ist zu groß.",
        );
    }

    return undefined;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    if (res.headersSent) {
        next(err);
        return;
    }

    const error =
        err instanceof AppError
            ? err
            : isUniqueConstraintError(err)
              ? new ConflictError()
              : bodyParserError(err) ?? err;

    if (error instanceof AppError) {
        res.status(error.status).json({
            error: error.message,
            code: error.code,
            ...(error.fields ? { fields: error.fields } : {}),
            ...(error.details ? { details: error.details } : {}),
            ...(config.isProduction ? {} : { stack: error.stack }),
        });
        return;
    }

    if (error instanceof ZodError) {
        const [first] = error.issues;
        res.status(400).json({
            error: first?.message ?? "Ungültige Anfrage.",
            code: "VALIDATION_ERROR",
            fields: Object.fromEntries(
                error.issues.map((issue) => [
                    issue.path.join(".") || "query",
                    issue.message,
                ]),
            ),
        });
        return;
    }

    logger.error({ err: error, reqId: req.id }, "unhandled error");

    res.status(500).json({
        error: config.isProduction
            ? "Ein unerwarteter Fehler ist aufgetreten."
            : error instanceof Error
              ? error.message
              : "Ein unerwarteter Fehler ist aufgetreten.",
        code: "INTERNAL_ERROR",
        ...(config.isProduction
            ? {}
            : { stack: error instanceof Error ? error.stack : undefined }),
    });
};
