import type { Request, Response } from "express";
import { parseLoginInput } from "@fleet-live/shared";
import { UserModel } from "../models/user.model";
import { SessionModel } from "../models/session.model";
import {
    clearSessionCookie,
    readCookie,
    SESSION_COOKIE,
    setSessionCookie,
} from "../lib/cookies";
import { hashPassword, needsRehash, verifyPassword } from "../lib/password";
import { UnauthorizedError } from "../lib/errors";

export function login(req: Request, res: Response) {
    const input = parseLoginInput(req.body);
    const user = UserModel.findByEmail(input.email);

    if (!user || !verifyPassword(input.password, user.password_hash)) {
        throw new UnauthorizedError("E-Mail oder Passwort ist falsch.");
    }

    if (needsRehash(user.password_hash)) {
        UserModel.setPasswordHash(user.id, hashPassword(input.password));
    }

    const token = SessionModel.create(user.id, input.remember);
    setSessionCookie(res, token, input.remember);

    res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        company_id: user.company_id,
    });
}

export function logout(req: Request, res: Response) {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);

    if (token) {
        SessionModel.delete(token);
    }

    clearSessionCookie(res);
    res.status(204).end();
}

export function getMe(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    res.json(req.user);
}
