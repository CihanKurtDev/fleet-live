import type { Request, Response } from "express";
import {
    parseAcceptInviteInput,
    parseChangePasswordInput,
    parseCompanyInput,
    parseEmailInput,
    parseInviteInput,
    parseLoginInput,
    parseMemberRoleInput,
    parseRegisterInput,
    parseResetInput,
    parseSecurityInput,
    parseSwitchCompanyInput,
    parseTokenInput,
    parseTotpCodeInput,
} from "@fleet-live/shared";
import { config } from "../config";
import {
    acceptInvite,
    authUserFor,
    companySecurity,
    consumeRecoveryCode,
    createCompanyForUser,
    dismissImportPrompt,
    inviteMember,
    listMembers,
    pickLoginCompany,
    publicSecurity,
    registerAccount,
    removeMember,
    replaceRecoveryCodes,
    resetPassword,
    setMemberRole,
    updateSecurity,
    userForPasswordReset,
    userForResend,
    verifyEmailToken,
} from "../models/account.model";
import { AuthTokenModel } from "../models/authToken.model";
import { membershipRow } from "../models/authView";
import { SessionModel } from "../models/session.model";
import { UserModel } from "../models/user.model";
import {
    clearSessionCookie,
    readCookie,
    SESSION_COOKIE,
} from "../lib/cookies";
import {
    AppError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
    ValidationError,
} from "../lib/errors";
import {
    assertMailConfigured,
    mailMessage,
    sendMail,
    type MailDelivery,
} from "../lib/mailer";
import { openSession } from "../lib/openSession";
import { hashPassword, needsRehash, verifyPassword } from "../lib/password";
import { seal } from "../lib/secretBox";
import { open as openSecret } from "../lib/secretBox";
import {
    base32Decode,
    base32Encode,
    newRecoveryCode,
    otpauthUrl,
    randomTotpSecret,
    verifyTotp,
} from "../lib/totp";

const INVALID_LINK = "Der Link ist ungültig oder abgelaufen.";

function deliveryMode(): MailDelivery {
    return config.smtpUrl && !config.isTest ? "smtp" : "log";
}

function linkFor(path: string, token: string): string {
    return `${config.webOrigin}${path}?token=${encodeURIComponent(token)}`;
}

async function mailLink(input: {
    to: string;
    subject: string;
    text: string;
    path: string;
    token: string;
}) {
    return sendMail({
        to: input.to,
        subject: input.subject,
        text: input.text,
        link: linkFor(input.path, input.token),
    });
}

export async function register(req: Request, res: Response) {
    assertMailConfigured();
    const input = parseRegisterInput(req.body);
    const user = registerAccount(input);
    AuthTokenModel.deleteForUser(user.id, "verify_email");
    const token = AuthTokenModel.issue({
        userId: user.id,
        purpose: "verify_email",
        ttl: "+24 hours",
    });
    const delivery = await mailLink({
        to: user.email,
        subject: "E-Mail bestätigen",
        text: "Bestätige deine E-Mail, danach kannst du dich anmelden.",
        path: "/email-bestaetigen",
        token,
    });

    res.status(201).json({
        email: user.email,
        delivery,
        message: mailMessage(
            delivery,
            "Bestätige deine E-Mail, danach kannst du dich anmelden.",
        ),
    });
}

export async function resendVerification(req: Request, res: Response) {
    assertMailConfigured();
    const { email } = parseEmailInput(req.body);
    const user = userForResend(email);

    if (user) {
        AuthTokenModel.deleteForUser(user.id, "verify_email");
        const token = AuthTokenModel.issue({
            userId: user.id,
            purpose: "verify_email",
            ttl: "+24 hours",
        });
        await mailLink({
            to: user.email,
            subject: "E-Mail bestätigen",
            text: "Bestätige deine E-Mail, danach kannst du dich anmelden.",
            path: "/email-bestaetigen",
            token,
        });
    }

    const delivery = deliveryMode();
    res.json({
        delivery,
        message: mailMessage(
            delivery,
            "Wenn ein unbestätigtes Konto existiert, gibt es einen Bestätigungslink.",
        ),
    });
}

export function verifyEmail(req: Request, res: Response) {
    const { token } = parseTokenInput(req.body);

    if (!verifyEmailToken(token)) {
        throw new ValidationError(INVALID_LINK);
    }

    res.status(204).end();
}

export function login(req: Request, res: Response) {
    const input = parseLoginInput(req.body);
    const user = UserModel.findByEmail(input.email);

    if (
        !user?.password_hash ||
        !verifyPassword(input.password, user.password_hash)
    ) {
        throw new UnauthorizedError("E-Mail oder Passwort ist falsch.");
    }

    if (needsRehash(user.password_hash)) {
        UserModel.setPasswordHash(user.id, hashPassword(input.password));
    }

    if (!user.email_verified_at) {
        throw new AppError(
            403,
            "EMAIL_UNVERIFIED",
            "Bitte bestätige zuerst deine E-Mail.",
        );
    }

    const company = pickLoginCompany(user.id);

    if (!company) {
        throw new UnauthorizedError("E-Mail oder Passwort ist falsch.");
    }

    if (company.sso_required === 1) {
        throw new AppError(
            403,
            "SSO_REQUIRED",
            "Diese Firma meldet sich über den Firmen-Login an.",
            undefined,
            { sso_company_id: company.company_id },
        );
    }

    const needsTotp = user.totp_enabled === 1 || company.totp_required === 1;

    if (needsTotp) {
        const challenge = AuthTokenModel.issue({
            userId: user.id,
            purpose: "login_challenge",
            ttl: "+10 minutes",
            companyId: company.company_id,
            payload: JSON.stringify({
                enroll: user.totp_enabled !== 1,
                remember: input.remember,
            }),
        });

        res.json({
            step: user.totp_enabled === 1 ? "totp" : "totp_enroll",
            challenge,
        });
        return;
    }

    res.json(openSession(req, res, user.id, company.company_id, input.remember));
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

export function logoutAll(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    SessionModel.deleteForUser(req.user.id);
    clearSessionCookie(res);
    res.status(204).end();
}

export async function forgotPassword(req: Request, res: Response) {
    assertMailConfigured();
    const { email } = parseEmailInput(req.body);
    const user = userForPasswordReset(email);

    if (user) {
        AuthTokenModel.deleteForUser(user.id, "reset_password");
        const token = AuthTokenModel.issue({
            userId: user.id,
            purpose: "reset_password",
            ttl: "+1 hour",
        });
        await mailLink({
            to: user.email,
            subject: "Passwort zurücksetzen",
            text: "Setze dein Passwort innerhalb einer Stunde neu. Danach ist der Link ungültig.",
            path: "/passwort-zuruecksetzen",
            token,
        });
    }

    const delivery = deliveryMode();
    res.json({
        delivery,
        message: mailMessage(
            delivery,
            "Wenn ein Konto mit Passwort existiert, gibt es einen Reset-Link.",
        ),
    });
}

export function resetPasswordHandler(req: Request, res: Response) {
    const input = parseResetInput(req.body);

    if (!resetPassword(input.token, input.password)) {
        throw new ValidationError(INVALID_LINK);
    }

    res.status(204).end();
}

export function changePassword(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    const input = parseChangePasswordInput(req.body);
    const user = UserModel.getById(req.user.id);

    if (!user?.password_hash || !verifyPassword(input.current_password, user.password_hash)) {
        throw new ValidationError("Aktuelles Passwort ist falsch.", {
            current_password: "Aktuelles Passwort ist falsch.",
        });
    }

    UserModel.setPasswordHash(user.id, hashPassword(input.password));
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);

    if (token) {
        SessionModel.deleteForUserExcept(user.id, token);
    }

    res.status(204).end();
}

export async function createInvite(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    assertMailConfigured();
    const input = parseInviteInput(req.body);
    const result = inviteMember(req.user.company_id, input.email, input.role);

    if (result.created) {
        const token = AuthTokenModel.issue({
            userId: result.user.id,
            purpose: "invite",
            ttl: "+7 days",
            companyId: req.user.company_id,
            role: input.role,
        });
        const delivery = await mailLink({
            to: result.user.email,
            subject: "Einladung zu fleet-live",
            text: "Du bist eingeladen. Lege dein Passwort fest, dann bist du in der Firma.",
            path: "/einladung",
            token,
        });
        res.status(201).json({ email: result.user.email, delivery });
        return;
    }

    const delivery = await sendMail({
        to: result.user.email,
        subject: "Neue Firma in fleet-live",
        text: "Du wurdest zu einer weiteren Firma hinzugefügt. Melde dich an und wechsle die Firma.",
        link: `${config.webOrigin}/login`,
    });
    res.status(201).json({ email: result.user.email, delivery });
}

export function acceptInviteHandler(req: Request, res: Response) {
    const input = parseAcceptInviteInput(req.body);
    const accepted = acceptInvite(input);

    if (!accepted) {
        throw new ValidationError(INVALID_LINK);
    }

    res.json(
        openSession(req, res, accepted.userId, accepted.companyId, false),
    );
}

export function getMembers(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    res.json({ data: listMembers(req.user.company_id) });
}

export function patchMember(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    const userId = Number(req.params.userId);
    const { role } = parseMemberRoleInput(req.body);

    if (!Number.isInteger(userId) || !setMemberRole(req.user.company_id, userId, role)) {
        throw new NotFoundError("Mitglied nicht gefunden.");
    }

    res.json({ data: listMembers(req.user.company_id) });
}

export function deleteMember(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId) || !removeMember(req.user.company_id, userId)) {
        throw new NotFoundError("Mitglied nicht gefunden.");
    }

    if (userId === req.user.id) {
        clearSessionCookie(res);
        res.status(204).end();
        return;
    }

    res.status(204).end();
}

export function createCompany(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    const { name } = parseCompanyInput(req.body);
    const companyId = createCompanyForUser(req.user.id, name);
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);

    if (!token) {
        throw new UnauthorizedError();
    }

    SessionModel.setCompany(token, companyId);
    const user = authUserFor(req.user.id, companyId);

    if (!user) {
        throw new UnauthorizedError();
    }

    res.status(201).json(user);
}

export function switchCompany(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    const { company_id: companyId } = parseSwitchCompanyInput(req.body);
    const row = membershipRow(req.user.id, companyId);

    if (!row) {
        throw new NotFoundError("Firma nicht gefunden.");
    }

    if (row.sso_required === 1) {
        throw new AppError(
            403,
            "SSO_REQUIRED",
            "Diese Firma meldet sich über den Firmen-Login an.",
            undefined,
            { sso_company_id: companyId },
        );
    }

    const record = UserModel.getById(req.user.id);

    if (row.totp_required === 1 && record?.totp_enabled !== 1) {
        throw new ForbiddenError(
            "Diese Firma verlangt Zwei-Faktor. Richte ihn im Konto ein.",
        );
    }

    const token = readCookie(req.headers.cookie, SESSION_COOKIE);

    if (!token) {
        throw new UnauthorizedError();
    }

    SessionModel.setCompany(token, companyId);
    res.json(authUserFor(req.user.id, companyId));
}

export function dismissImport(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    if (req.user.role !== "dispatcher") {
        throw new ForbiddenError();
    }

    dismissImportPrompt(req.user.company_id);
    res.json(authUserFor(req.user.id, req.user.company_id));
}

export function getSecurity(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    const security = publicSecurity(req.user.company_id);

    if (!security) {
        throw new NotFoundError("Firma nicht gefunden.");
    }

    res.json(security);
}

export function patchSecurity(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    updateSecurity(req.user.company_id, parseSecurityInput(req.body));
    res.json(publicSecurity(req.user.company_id));
}

type ChallengePayload = {
    enroll?: boolean;
    remember?: boolean;
    secret?: string;
};

function challengePayload(raw: string | null): ChallengePayload {
    if (!raw) {
        return {};
    }

    try {
        return JSON.parse(raw) as ChallengePayload;
    } catch {
        return {};
    }
}

export function setupTotp(req: Request, res: Response) {
    const body = (req.body ?? {}) as { challenge?: string };
    const secret = randomTotpSecret();
    const encoded = base32Encode(secret);

    if (typeof body.challenge === "string" && body.challenge) {
        const row = AuthTokenModel.find(body.challenge, "login_challenge");

        if (!row?.user_id) {
            throw new UnauthorizedError("Der Schritt ist abgelaufen.");
        }

        const user = UserModel.getById(row.user_id);

        if (!user) {
            throw new UnauthorizedError();
        }

        const payload = challengePayload(row.payload);
        payload.secret = encoded;
        AuthTokenModel.setPayload(row.id, JSON.stringify(payload));
        res.json({
            secret: encoded,
            otpauth_url: otpauthUrl(user.email, secret),
        });
        return;
    }

    if (!req.user) {
        throw new UnauthorizedError();
    }

    const setupToken = AuthTokenModel.issue({
        userId: req.user.id,
        purpose: "totp_setup",
        ttl: "+10 minutes",
        payload: JSON.stringify({ secret: encoded }),
    });

    res.json({
        secret: encoded,
        otpauth_url: otpauthUrl(req.user.email, secret),
        setup_token: setupToken,
    });
}

function enableTotp(userId: number, encodedSecret: string, code: string): string[] {
    if (!verifyTotp(base32Decode(encodedSecret), code)) {
        throw new ValidationError("Code ist falsch.", {
            code: "Code ist falsch.",
        });
    }

    UserModel.setTotp(userId, seal(encodedSecret), true);
    const codes = Array.from({ length: 8 }, () => newRecoveryCode());
    replaceRecoveryCodes(userId, codes);
    return codes;
}

export function confirmTotp(req: Request, res: Response) {
    const input = parseTotpCodeInput(req.body);

    if (input.challenge) {
        const row = AuthTokenModel.find(input.challenge, "login_challenge");

        if (!row?.user_id || !row.company_id) {
            throw new UnauthorizedError("Der Schritt ist abgelaufen.");
        }

        const user = UserModel.getById(row.user_id);

        if (!user) {
            throw new UnauthorizedError();
        }

        const payload = challengePayload(row.payload);
        let recovery: string[] | undefined;

        if (payload.secret) {
            recovery = enableTotp(user.id, payload.secret, input.code);
        } else if (
            user.totp_enabled === 1 &&
            user.totp_secret &&
            verifyTotp(base32Decode(openSecret(user.totp_secret)), input.code)
        ) {
            recovery = undefined;
        } else if (consumeRecoveryCode(user.id, input.code)) {
            recovery = undefined;
        } else {
            throw new UnauthorizedError("Code ist falsch.");
        }

        AuthTokenModel.consume(row.id);
        const auth = openSession(
            req,
            res,
            user.id,
            row.company_id,
            payload.remember === true,
        );
        res.json(recovery ? { ...auth, recovery_codes: recovery } : auth);
        return;
    }

    if (!req.user || !input.setup_token) {
        throw new ValidationError("Einrichtung ist abgelaufen.");
    }

    const row = AuthTokenModel.find(input.setup_token, "totp_setup");

    if (!row || row.user_id !== req.user.id) {
        throw new ValidationError("Einrichtung ist abgelaufen.");
    }

    const payload = challengePayload(row.payload);

    if (!payload.secret) {
        throw new ValidationError("Einrichtung ist abgelaufen.");
    }

    const recovery = enableTotp(req.user.id, payload.secret, input.code);
    AuthTokenModel.consume(row.id);
    const auth = authUserFor(req.user.id, req.user.company_id);
    res.json({ ...auth, recovery_codes: recovery });
}

export function disableTotp(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    const input = parseTotpCodeInput(req.body);
    const company = companySecurity(req.user.company_id);

    if (company?.totp_required === 1) {
        throw new ForbiddenError(
            "Die Firma verlangt Zwei-Faktor. Ausschalten ist nicht möglich.",
        );
    }

    const user = UserModel.getById(req.user.id);

    if (
        !user?.totp_secret ||
        !verifyTotp(base32Decode(openSecret(user.totp_secret)), input.code)
    ) {
        throw new ValidationError("Code ist falsch.", {
            code: "Code ist falsch.",
        });
    }

    UserModel.setTotp(user.id, null, false);
    replaceRecoveryCodes(user.id, []);
    res.json(authUserFor(user.id, req.user.company_id));
}
