import type { Request, Response, NextFunction } from "express";
import type { AuthUser } from "@fleet-live/shared";
import { readCookie, SESSION_COOKIE } from "../lib/cookies";
import { SessionModel } from "../models/session.model";
import type { SessionProof } from "../models/sessionPolicy";

declare global {
    namespace Express {
        interface Request {
            id: string;
            user?: AuthUser;
            /** The session behind `user`: its cookie token and what it proved. */
            auth?: { token: string; proof: SessionProof };
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

    const session = SessionModel.find(token);

    if (session) {
        req.user = session.user;
        req.auth = { token, proof: session.proof };
    }

    next();
}
