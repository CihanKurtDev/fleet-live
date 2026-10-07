import type { Request, Response } from "express";
import type { AuthUser } from "@fleet-live/shared";
import {
    readCookie,
    SESSION_COOKIE,
    setSessionCookie,
} from "./cookies";
import { authUserFor } from "../models/account.model";
import { SessionModel } from "../models/session.model";

export function openSession(
    req: Request,
    res: Response,
    userId: number,
    companyId: number,
    persist: boolean,
): AuthUser {
    const previous = readCookie(req.headers.cookie, SESSION_COOKIE);

    if (previous) {
        SessionModel.delete(previous);
    }

    const token = SessionModel.create(userId, companyId, persist);
    setSessionCookie(res, token, persist);
    const user = authUserFor(userId, companyId);

    if (!user) {
        throw new Error("Session ohne Mitgliedschaft.");
    }

    return user;
}
