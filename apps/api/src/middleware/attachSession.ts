import type { Request, Response, NextFunction } from "express";
import type { AuthUser } from "@fleet-live/shared";
import { readCookie, SESSION_COOKIE } from "../lib/cookies";
import { SessionModel } from "../models/session.model";

declare global {
    namespace Express {
        interface Request {
            id: string;
            user?: AuthUser;
        }
    }
}

export function attachSession(
    req: Request,
    _res: Response,
    next: NextFunction,
) {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);

    if (!token) {
        next();
        return;
    }

    req.user = SessionModel.findUser(token);
    next();
}
