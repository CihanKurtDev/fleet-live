import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { config } from "../config";
import { logger } from "../logger";
import {
    AppError,
    ConflictError,
    isUniqueConstraintError,
} from "../lib/errors";

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    if (res.headersSent) {
        next(err);
        return;
    }

    const error = isUniqueConstraintError(err)
        ? new ConflictError()
        : err;

    if (error instanceof AppError) {
        res.status(error.status).json({
            error: error.message,
            code: error.code,
            ...(error.fields ? { fields: error.fields } : {}),
            ...(config.isProduction ? {} : { stack: error.stack }),
        });
        return;
    }

    if (error instanceof ZodError) {
        const [first] = error.issues;
        res.status(400).json({
            error: first?.message ?? "Invalid request.",
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
            ? "An unexpected error occurred."
            : error instanceof Error
              ? error.message
              : "An unexpected error occurred.",
        code: "INTERNAL_ERROR",
        ...(config.isProduction
            ? {}
            : { stack: error instanceof Error ? error.stack : undefined }),
    });
};
