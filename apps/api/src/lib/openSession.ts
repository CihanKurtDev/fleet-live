import type { Request, Response } from "express";
import type { AuthUser } from "@fleet-live/shared";
import {
    readCookie,
    SESSION_COOKIE,
    setSessionCookie,
} from "./cookies";
import { AppError, UnauthorizedError } from "./errors";
import { authUserFor } from "../models/account.model";
import { AuthTokenModel } from "../models/authToken.model";
import { decideLogin } from "../models/loginPolicy";
import { SessionModel } from "../models/session.model";
import type { SessionProof } from "../models/sessionPolicy";

/** Opens a new session; the previous one of this browser ends (no fixation). */
export function openSession(
    req: Request,
    res: Response,
    userId: number,
    companyId: number,
    persist: boolean,
    proof: SessionProof,
): AuthUser {
    const previous = readCookie(req.headers.cookie, SESSION_COOKIE);

    if (previous) {
        SessionModel.delete(previous);
    }

    const token = SessionModel.create(userId, companyId, persist, proof);
    setSessionCookie(res, token, persist);
    const user = authUserFor(userId, companyId);

    if (!user) {
        throw new Error("Session ohne Mitgliedschaft.");
    }

    return user;
}

export type LoginStep = {
    userId: number;
    companyId: number;
    remember: boolean;
} & SessionProof;

export type LoginOutcome =
    | { kind: "session"; user: AuthUser }
    | { kind: "totp"; step: "totp" | "totp_enroll"; challenge: string }
    | { kind: "sso_required"; companyId: number; linkChallenge?: string }
    | { kind: "denied" };

/** What a login step carries on to the second factor. */
export type ChallengePayload = {
    /** The step was issued to set up a second factor, not to ask for one. */
    enroll?: boolean;
    remember?: boolean;
    /** The company login that already signed the person in, if any. */
    sso_company_id?: number | null;
    secret?: string;
    failures?: number;
};

/**
 * Turns a finished login step into its next step through the one decision
 * (`decideLogin`): a session only when nothing is missing, otherwise a step
 * that can be used for exactly the missing part.
 */
export function continueLogin(
    req: Request,
    res: Response,
    step: LoginStep,
): LoginOutcome {
    const proof = { mfa: step.mfa, ssoCompanyId: step.ssoCompanyId };
    const decision = decideLogin(step.userId, step.companyId, proof);

    if (decision.kind === "session") {
        return {
            kind: "session",
            user: openSession(req, res, step.userId, step.companyId, step.remember, proof),
        };
    }

    if (decision.kind === "totp") {
        const challenge = AuthTokenModel.issue({
            userId: step.userId,
            purpose: "login_challenge",
            ttl: "+10 minutes",
            companyId: step.companyId,
            payload: JSON.stringify({
                enroll: decision.enroll,
                remember: step.remember,
                sso_company_id: step.ssoCompanyId,
            } satisfies ChallengePayload),
        });

        return {
            kind: "totp",
            step: decision.enroll ? "totp_enroll" : "totp",
            challenge,
        };
    }

    if (decision.kind === "sso_required") {
        // Lets this person link the company login once, in the next 10 minutes,
        // after everything else of the login has been passed.
        const linkChallenge = decision.link
            ? AuthTokenModel.issue({
                  userId: step.userId,
                  purpose: "sso_link",
                  ttl: "+10 minutes",
                  companyId: step.companyId,
                  payload: JSON.stringify({ mfa: step.mfa }),
              })
            : undefined;

        return { kind: "sso_required", companyId: step.companyId, linkChallenge };
    }

    return { kind: "denied" };
}

export const SSO_REQUIRED_MESSAGE = "Diese Firma meldet sich über den Firmen-Login an.";

/** The JSON answer of a login step (password, second factor). */
export function sendLoginOutcome(res: Response, outcome: LoginOutcome) {
    if (outcome.kind === "session") {
        res.json(outcome.user);
        return;
    }

    if (outcome.kind === "totp") {
        res.json({ step: outcome.step, challenge: outcome.challenge });
        return;
    }

    if (outcome.kind === "sso_required") {
        throw new AppError(403, "SSO_REQUIRED", SSO_REQUIRED_MESSAGE, undefined, {
            sso_company_id: outcome.companyId,
            ...(outcome.linkChallenge ? { link_challenge: outcome.linkChallenge } : {}),
        });
    }

    throw new UnauthorizedError("E-Mail oder Passwort ist falsch.");
}
