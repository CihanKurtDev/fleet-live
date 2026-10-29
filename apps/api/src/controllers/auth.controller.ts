import type { Request, Response } from "express";
import {
    parseAcceptInviteInput,
    parseAuditListQuery,
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
    type SecurityChange,
} from "@fleet-live/shared";
import { config } from "../config";
import {
    acceptInvitation,
    acceptInvite,
    authUserFor,
    companySecurity,
    consumeRecoveryCode,
    createCompanyForUser,
    declineInvitation,
    dismissImportPrompt,
    hasSsoIdentity,
    inviteMember,
    listInvitations,
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
    withdrawInvite,
} from "../models/account.model";
import { AuditModel } from "../models/audit.model";
import { AuthTokenModel } from "../models/authToken.model";
import { listMemberships, membershipRow } from "../models/authView";
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
import {
    continueLogin,
    openSession,
    sendLoginOutcome,
    SSO_REQUIRED_MESSAGE,
    type ChallengePayload,
} from "../lib/openSession";
import { companyProvider, decideLogin } from "../models/loginPolicy";
import { policyGap, type PolicyGap } from "../models/sessionPolicy";
import { endStreams } from "../sse/hub";
import {
    hashPasswordAsync,
    needsRehash,
    spendPasswordTime,
    verifyPasswordAsync,
} from "../lib/password";
import { seal } from "../lib/secretBox";
import { open as openSecret } from "../lib/secretBox";
import {
    base32Decode,
    base32Encode,
    newRecoveryCode,
    otpauthUrl,
    randomTotpSecret,
    totpStep,
    verifyTotp,
} from "../lib/totp";
import {
    clearTotpFailures,
    recordTotpFailure,
    tooManyTotpFailures,
} from "../lib/totpAttempts";

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
    const company = listMemberships(user.id)[0];

    if (company) {
        AuditModel.record({
            companyId: company.company_id,
            action: "company_created",
            actorId: user.id,
        });
    }

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

export async function login(req: Request, res: Response) {
    const input = parseLoginInput(req.body);
    const user = UserModel.findByEmail(input.email);

    if (!user?.password_hash) {
        // The same wait as for a wrong password, so the answer does not
        // tell whether the email has an account.
        await spendPasswordTime(input.password);
        throw new UnauthorizedError("E-Mail oder Passwort ist falsch.");
    }

    if (!(await verifyPasswordAsync(input.password, user.password_hash))) {
        throw new UnauthorizedError("E-Mail oder Passwort ist falsch.");
    }

    if (needsRehash(user.password_hash)) {
        UserModel.setPasswordHash(
            user.id,
            await hashPasswordAsync(input.password),
        );
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

    sendLoginOutcome(
        res,
        continueLogin(req, res, {
            userId: user.id,
            companyId: company.company_id,
            remember: input.remember,
            mfa: false,
            ssoCompanyId: null,
        }),
    );
}

export function logout(req: Request, res: Response) {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);

    if (token) {
        SessionModel.delete(token);
        endStreams({ token });
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
    endStreams({ userId: req.user.id });
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

    const userId = resetPassword(input.token, input.password);

    if (userId === undefined) {
        throw new ValidationError(INVALID_LINK);
    }

    endStreams({ userId });

    res.status(204).end();
}

export async function changePassword(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    const input = parseChangePasswordInput(req.body);
    const user = UserModel.getById(req.user.id);

    if (
        !user?.password_hash ||
        !(await verifyPasswordAsync(input.current_password, user.password_hash))
    ) {
        throw new ValidationError("Aktuelles Passwort ist falsch.", {
            current_password: "Aktuelles Passwort ist falsch.",
        });
    }

    UserModel.setPasswordHash(user.id, await hashPasswordAsync(input.password));
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);

    if (token) {
        SessionModel.deleteForUserExcept(user.id, token);
        endStreams({ userId: user.id, exceptToken: token });
    }

    res.status(204).end();
}

export async function createInvite(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    assertMailConfigured();
    const input = parseInviteInput(req.body);
    const company = req.user.company_name;
    const result = inviteMember(
        req.user.company_id,
        input.email,
        input.role,
        req.user.id,
    );
    AuditModel.record({
        companyId: req.user.company_id,
        action: "invite_created",
        actorId: req.user.id,
        targetId: result.user.id,
        details: { role: input.role },
    });

    if (result.activate) {
        const token = AuthTokenModel.issue({
            userId: result.user.id,
            purpose: "invite",
            ttl: "+7 days",
            companyId: req.user.company_id,
            role: input.role,
        });
        const delivery = await mailLink({
            to: result.user.email,
            subject: `Einladung zu ${company} in fleet-live`,
            text: `${req.user.name} lädt dich zu ${company} ein. Lege dein Passwort fest, dann bist du in der Firma.`,
            path: "/einladung",
            token,
        });
        res.status(201).json({ email: result.user.email, delivery });
        return;
    }

    // An existing account decides itself: nothing changes until it accepts.
    const delivery = await sendMail({
        to: result.user.email,
        subject: `Einladung zu ${company} in fleet-live`,
        text: `${req.user.name} lädt dich zu ${company} ein. Melde dich an und nimm die Einladung unter Konto → Firmen an oder lehne sie ab.`,
        link: `${config.webOrigin}/konto#firmen`,
    });
    res.status(201).json({ email: result.user.email, delivery });
}

type SecurityRow = NonNullable<ReturnType<typeof companySecurity>>;

/** What a save of the sign-in rules changed, for the log. */
function securityChanges(before: SecurityRow, after: SecurityRow): SecurityChange[] {
    const changes: SecurityChange[] = [];

    if (before.totp_required !== after.totp_required) {
        changes.push(after.totp_required === 1 ? "totp_required_on" : "totp_required_off");
    }

    if (before.sso_required !== after.sso_required) {
        changes.push(after.sso_required === 1 ? "sso_required_on" : "sso_required_off");
    }

    if (before.sso_issuer !== after.sso_issuer || before.sso_client_id !== after.sso_client_id) {
        changes.push("sso_settings");
    }

    if (before.sso_client_secret !== after.sso_client_secret) {
        changes.push("sso_secret");
    }

    return changes;
}

export function getAudit(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    const { page } = parseAuditListQuery(req.query);
    res.json(AuditModel.list(req.user.company_id, page));
}

export function getInvitations(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    res.json({ data: listInvitations(req.user.id) });
}

function invitationCompanyId(req: Request): number {
    const companyId = Number(req.params.companyId);

    if (!Number.isInteger(companyId)) {
        throw new NotFoundError("Einladung nicht gefunden.");
    }

    return companyId;
}

export function acceptInvitationHandler(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    const companyId = invitationCompanyId(req);

    if (!acceptInvitation(req.user.id, companyId)) {
        throw new NotFoundError("Einladung nicht gefunden.");
    }

    AuditModel.record({
        companyId,
        action: "invite_accepted",
        actorId: req.user.id,
        details: { role: membershipRow(req.user.id, companyId)?.role },
    });

    // The session stays in its company; the new one is a switch away.
    res.json(authUserFor(req.user.id, req.user.company_id));
}

export function declineInvitationHandler(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    const companyId = invitationCompanyId(req);

    if (!declineInvitation(req.user.id, companyId)) {
        throw new NotFoundError("Einladung nicht gefunden.");
    }

    AuditModel.record({ companyId, action: "invite_declined", actorId: req.user.id });

    res.json(authUserFor(req.user.id, req.user.company_id));
}

export function withdrawInviteHandler(req: Request, res: Response) {
    if (!req.user) {
        throw new UnauthorizedError();
    }

    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId) || !withdrawInvite(req.user.company_id, userId)) {
        throw new NotFoundError("Einladung nicht gefunden.");
    }

    AuditModel.record({
        companyId: req.user.company_id,
        action: "invite_withdrawn",
        actorId: req.user.id,
        targetId: userId,
    });

    res.json({ data: listMembers(req.user.company_id) });
}

export function acceptInviteHandler(req: Request, res: Response) {
    const input = parseAcceptInviteInput(req.body);
    const accepted = acceptInvite(input);

    if (!accepted) {
        throw new ValidationError(INVALID_LINK);
    }

    AuditModel.record({
        companyId: accepted.companyId,
        action: "invite_accepted",
        actorId: accepted.userId,
        details: { role: membershipRow(accepted.userId, accepted.companyId)?.role },
    });

    // The invite proves the e-mail, not the factors the company requires.
    const proof = { mfa: false, ssoCompanyId: null };

    if (decideLogin(accepted.userId, accepted.companyId, proof).kind !== "session") {
        res.json({ next: "login" });
        return;
    }

    res.json(
        openSession(req, res, accepted.userId, accepted.companyId, false, proof),
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
    const before = Number.isInteger(userId)
        ? membershipRow(userId, req.user.company_id)?.role
        : undefined;

    if (!Number.isInteger(userId) || !setMemberRole(req.user.company_id, userId, role)) {
        throw new NotFoundError("Mitglied nicht gefunden.");
    }

    if (before !== role) {
        AuditModel.record({
            companyId: req.user.company_id,
            action: "member_role_changed",
            actorId: req.user.id,
            targetId: userId,
            details: { from: before, to: role },
        });
    }

    // Open streams of that person in this company reconnect with the new role.
    endStreams({ userId, companyId: req.user.company_id });

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

    AuditModel.record({
        companyId: req.user.company_id,
        action: userId === req.user.id ? "member_left" : "member_removed",
        actorId: req.user.id,
        targetId: userId === req.user.id ? null : userId,
    });
    endStreams({ userId, companyId: req.user.company_id });

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
    const token = req.auth?.token;

    if (!token) {
        throw new UnauthorizedError();
    }

    // A session of a company login stays in that company.
    if (req.auth?.proof.ssoCompanyId !== null) {
        throw switchRefused("sso_scope", 0);
    }

    const companyId = createCompanyForUser(req.user.id, name);
    AuditModel.record({ companyId, action: "company_created", actorId: req.user.id });
    SessionModel.setCompany(token, companyId);
    endStreams({ token });
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
    const auth = req.auth;

    if (!auth) {
        throw new UnauthorizedError();
    }

    // The same rules as for a new session: a company that requires its own
    // login or a second factor needs a session that passed them.
    const gap = policyGap(req.user.id, companyId, auth.proof);

    if (gap !== null) {
        throw switchRefused(gap, companyId);
    }

    SessionModel.setCompany(auth.token, companyId);
    // A stream belongs to the company it was opened for.
    endStreams({ token: auth.token });
    res.json(authUserFor(req.user.id, companyId));
}

function switchRefused(gap: PolicyGap, companyId: number): AppError {
    if (gap === "no_membership") {
        return new NotFoundError("Firma nicht gefunden.");
    }

    if (gap === "sso_scope") {
        return new AppError(
            403,
            "REAUTH_REQUIRED",
            "Der Firmen-Login gilt nur für seine Firma. Melde dich für die andere Firma neu an.",
        );
    }

    if (gap === "sso_required") {
        return new AppError(403, "SSO_REQUIRED", SSO_REQUIRED_MESSAGE, undefined, {
            sso_company_id: companyId,
        });
    }

    return new AppError(
        403,
        "TOTP_REQUIRED",
        "Diese Firma verlangt Zwei-Faktor. Richte ihn im Konto ein und melde dich neu an.",
    );
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

    const input = parseSecurityInput(req.body);
    const current = companySecurity(req.user.company_id);
    const proof = req.auth?.proof;

    if (!current || !proof) {
        throw new UnauthorizedError();
    }

    // Turning a rule on that this very session does not meet would lock the
    // dispatcher out, and with the last dispatcher the whole company.
    if (input.totp_required === true && current.totp_required !== 1 && !proof.mfa) {
        throw new AppError(
            403,
            "TOTP_REQUIRED",
            "Richte zuerst selbst Zwei-Faktor ein und melde dich damit an.",
        );
    }

    // The dispatcher who requires the company login must have used it: a
    // session of that login, or an own link to the configured issuer.
    if (
        input.sso_required === true &&
        current.sso_required !== 1 &&
        proof.ssoCompanyId !== req.user.company_id &&
        !hasSsoIdentity(
            req.user.id,
            companyProvider(req.user.company_id),
            current.sso_issuer,
        )
    ) {
        throw new AppError(
            403,
            "SSO_LINK_REQUIRED",
            "Verknüpfe zuerst dein Konto mit dem Firmen-Login, dann lässt er sich verlangen.",
            undefined,
            { company_id: req.user.company_id },
        );
    }

    updateSecurity(req.user.company_id, input);
    const next = companySecurity(req.user.company_id);
    const changes = next ? securityChanges(current, next) : [];

    if (changes.length > 0) {
        AuditModel.record({
            companyId: req.user.company_id,
            action: "security_changed",
            actorId: req.user.id,
            details: { changes },
        });
    }

    // Sessions that no longer meet stricter rules end on their next request;
    // their streams end now.
    if (
        (next?.totp_required === 1 && current.totp_required !== 1) ||
        (next?.sso_required === 1 && current.sso_required !== 1)
    ) {
        endStreams({ companyId: req.user.company_id });
    }

    res.json(publicSecurity(req.user.company_id));
}

/** Wrong codes one login step accepts before it is used up. */
const MAX_STEP_FAILURES = 5;

const TOTP_LOCKED_MESSAGE =
    "Zu viele falsche Codes. Bitte später erneut versuchen.";

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

        // Only a step that was issued for setting up a second factor may
        // choose one. A step that asks for the existing factor never replaces it.
        if (payload.enroll !== true || user.totp_enabled === 1) {
            throw new ForbiddenError("Zwei-Faktor ist schon eingerichtet.");
        }

        // The step row holds the new secret sealed, like the account does.
        payload.secret = seal(encoded);
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
        payload: JSON.stringify({ secret: seal(encoded) }),
    });

    res.json({
        secret: encoded,
        otpauth_url: otpauthUrl(req.user.email, secret),
        setup_token: setupToken,
    });
}

/**
 * The code of the account's own authenticator, once per time step: a code
 * that was already accepted (or an older one) is wrong.
 */
function acceptTotpCode(
    user: { id: number; totp_secret: string | null; totp_last_step: number | null },
    code: string,
): boolean {
    if (!user.totp_secret) {
        return false;
    }

    const step = totpStep(base32Decode(openSecret(user.totp_secret)), code);

    if (step === null || (user.totp_last_step !== null && step <= user.totp_last_step)) {
        return false;
    }

    UserModel.setTotpLastStep(user.id, step);
    return true;
}

/** The secret a set-up step carries, or nothing when it is missing or unreadable. */
function stepSecret(payload: ChallengePayload): string | undefined {
    if (!payload.secret) {
        return undefined;
    }

    try {
        return openSecret(payload.secret);
    } catch {
        return undefined;
    }
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

        if (tooManyTotpFailures(user.id)) {
            throw new AppError(429, "TOTP_RATE_LIMITED", TOTP_LOCKED_MESSAGE);
        }

        // The secret of the step is used only to set up a factor the account
        // does not have yet; otherwise the code is checked against the stored one.
        const enrolling = payload.enroll === true && user.totp_enabled !== 1;

        try {
            const secret = stepSecret(payload);

            if (enrolling && secret) {
                recovery = enableTotp(user.id, secret, input.code);
            } else if (
                user.totp_enabled === 1 &&
                acceptTotpCode(user, input.code)
            ) {
                recovery = undefined;
            } else if (!enrolling && consumeRecoveryCode(user.id, input.code)) {
                recovery = undefined;
            } else {
                throw new UnauthorizedError("Code ist falsch.");
            }
        } catch (error) {
            // A wrong code counts against this step and against the account.
            recordTotpFailure(user.id);
            const failures = (payload.failures ?? 0) + 1;

            if (failures >= MAX_STEP_FAILURES) {
                AuthTokenModel.consume(row.id);
                throw new UnauthorizedError(
                    "Zu viele falsche Codes. Melde dich neu an.",
                );
            }

            AuthTokenModel.setPayload(
                row.id,
                JSON.stringify({ ...payload, failures }),
            );
            throw error;
        }

        clearTotpFailures(user.id);

        if (!AuthTokenModel.claim(input.challenge, "login_challenge")) {
            throw new UnauthorizedError("Der Schritt ist abgelaufen.");
        }

        const outcome = continueLogin(req, res, {
            userId: user.id,
            companyId: row.company_id,
            remember: payload.remember === true,
            mfa: true,
            ssoCompanyId: payload.sso_company_id ?? null,
        });

        if (outcome.kind === "session" && recovery) {
            res.json({ ...outcome.user, recovery_codes: recovery });
            return;
        }

        sendLoginOutcome(res, outcome);
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

    const secret = stepSecret(payload);

    if (!secret) {
        throw new ValidationError("Einrichtung ist abgelaufen.");
    }

    const recovery = enableTotp(req.user.id, secret, input.code);
    AuthTokenModel.consume(row.id);

    // This session has just shown the new factor.
    if (req.auth) {
        SessionModel.setMfa(req.auth.token);
    }

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

    if (user && tooManyTotpFailures(user.id)) {
        throw new AppError(429, "TOTP_RATE_LIMITED", TOTP_LOCKED_MESSAGE);
    }

    if (!user?.totp_secret || !acceptTotpCode(user, input.code)) {
        if (user) {
            recordTotpFailure(user.id);
        }

        throw new ValidationError("Code ist falsch.", {
            code: "Code ist falsch.",
        });
    }

    clearTotpFailures(user.id);
    UserModel.setTotp(user.id, null, false);
    replaceRecoveryCodes(user.id, []);
    res.json(authUserFor(user.id, req.user.company_id));
}
