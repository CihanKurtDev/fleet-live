import type { Request, Response, NextFunction } from "express";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";

export function requireDispatcher(
    req: Request,
    _res: Response,
    next: NextFunction,
) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    if (req.user.role !== "dispatcher") {
        throw new ForbiddenError();
    }

    next();
}
