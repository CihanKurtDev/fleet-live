import type { Request, Response, NextFunction } from "express";
import { UnauthorizedError } from "../lib/errors";

export function requireAuth(
    req: Request,
    _res: Response,
    next: NextFunction,
) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    next();
}
