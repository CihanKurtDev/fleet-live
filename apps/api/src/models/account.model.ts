import type { SecurityInput, UserRole } from "@fleet-live/shared";
import { withTransaction } from "../db/database";
import { stmt } from "../db/statements";
import {
    ConflictError,
    ForbiddenError,
    ValidationError,
} from "../lib/errors";
import { hashPassword } from "../lib/password";
import { open, seal } from "../lib/secretBox";
import { hashToken } from "../lib/tokenHash";
import { AuthTokenModel } from "./authToken.model";
import { listMemberships, presentUser } from "./authView";
import { SessionModel } from "./session.model";
import { UserModel, type UserRecord } from "./user.model";

type CompanySecurityRow = {
    id: number;
    name: string;
    totp_required: number;
    sso_required: number;
    sso_issuer: string | null;
    sso_client_id: string | null;
    sso_client_secret: string | null;
};

function companyByName(name: string) {
    return stmt(
        "SELECT id FROM companies WHERE name = ? COLLATE NOCASE",
    ).get(name) as { id: number } | undefined;
}

function insertCompany(name: string): number {
    const result = stmt("INSERT INTO companies (name) VALUES (?)").run(name);
    return Number(result.lastInsertRowid);
}

function dispatcherCount(companyId: number): number {
    const row = stmt(
        `
        SELECT COUNT(*) AS n
        FROM company_memberships
        WHERE company_id = ?
          AND role = 'dispatcher'
        `,
    ).get(companyId) as { n: number };

    return row.n;
}

function membershipRole(userId: number, companyId: number): UserRole | undefined {
    const row = stmt(
        `
        SELECT role
        FROM company_memberships
        WHERE user_id = ?
          AND company_id = ?
        `,
    ).get(userId, companyId) as { role: UserRole } | undefined;

    return row?.role;
}

export function registerAccount(input: {
    company_name: string;
    name: string;
    email: string;
    password: string;
}): UserRecord {
    return withTransaction(() => {
        if (UserModel.findByEmail(input.email)) {
            throw new ConflictError("E-Mail ist bereits registriert.", {
                email: "E-Mail ist bereits registriert.",
            });
        }

        if (companyByName(input.company_name)) {
            throw new ConflictError("Firmenname ist bereits vergeben.", {
                company_name: "Firmenname ist bereits vergeben.",
            });
        }

        const companyId = insertCompany(input.company_name);

        return UserModel.create({
            name: input.name,
            email: input.email,
            password: input.password,
            company_id: companyId,
            role: "dispatcher",
            verified: false,
        });
    });
}

export function verifyEmailToken(token: string): boolean {
    const row = AuthTokenModel.find(token, "verify_email");

    if (!row?.user_id) {
        return false;
    }

    UserModel.markEmailVerified(row.user_id);
    AuthTokenModel.consume(row.id);
    return true;
}

export function userForResend(email: string): UserRecord | undefined {
    const user = UserModel.findByEmail(email);

    if (!user || user.email_verified_at) {
        return undefined;
    }

    return user;
}

export function userForPasswordReset(email: string): UserRecord | undefined {
    const user = UserModel.findByEmail(email);

    if (!user?.password_hash) {
        return undefined;
    }

    return user;
}

export function resetPassword(token: string, password: string): boolean {
    const row = AuthTokenModel.find(token, "reset_password");

    if (!row?.user_id) {
        return false;
    }

    UserModel.setPasswordHash(row.user_id, hashPassword(password));
    UserModel.markEmailVerified(row.user_id);
    AuthTokenModel.consume(row.id);
    SessionModel.deleteForUser(row.user_id);
    return true;
}

export function inviteMember(
    companyId: number,
    email: string,
    role: UserRole,
): { user: UserRecord; created: boolean } {
    return withTransaction(() => {
        const existing = UserModel.findByEmail(email);

        if (existing && membershipRole(existing.id, companyId)) {
            throw new ConflictError("Diese Person ist schon in der Firma.", {
                email: "Diese Person ist schon in der Firma.",
            });
        }

        if (existing) {
            stmt(
                `
                INSERT INTO company_memberships (user_id, company_id, role)
                VALUES (?, ?, ?)
                `,
            ).run(existing.id, companyId, role);

            return { user: existing, created: false };
        }

        const user = UserModel.create({
            name: email.split("@")[0] || "Eingeladen",
            email,
            password: null,
            company_id: companyId,
            role,
            verified: false,
        });

        return { user, created: true };
    });
}

export function acceptInvite(input: {
    token: string;
    name: string;
    password: string;
}): { userId: number; companyId: number } | undefined {
    const row = AuthTokenModel.find(input.token, "invite");

    if (!row?.user_id || !row.company_id) {
        return undefined;
    }

    UserModel.setName(row.user_id, input.name);
    UserModel.setPasswordHash(row.user_id, hashPassword(input.password));
    UserModel.markEmailVerified(row.user_id);
    AuthTokenModel.consume(row.id);

    return { userId: row.user_id, companyId: row.company_id };
}

export type MemberRow = {
    user_id: number;
    name: string;
    email: string;
    role: UserRole;
};

export function listMembers(companyId: number): MemberRow[] {
    return stmt(
        `
        SELECT u.id AS user_id, u.name, u.email, m.role
        FROM company_memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.company_id = ?
        ORDER BY u.name COLLATE NOCASE
        `,
    ).all(companyId) as MemberRow[];
}

function assertDispatcherRemains(
    companyId: number,
    userId: number,
    nextRole: UserRole | null,
) {
    const current = membershipRole(userId, companyId);

    if (current !== "dispatcher") {
        return;
    }

    if (nextRole === "dispatcher") {
        return;
    }

    if (dispatcherCount(companyId) <= 1) {
        throw new ForbiddenError(
            "Die Firma braucht mindestens einen Dispatcher.",
        );
    }
}

export function setMemberRole(
    companyId: number,
    userId: number,
    role: UserRole,
) {
    if (!membershipRole(userId, companyId)) {
        return false;
    }

    assertDispatcherRemains(companyId, userId, role);
    stmt(
        `
        UPDATE company_memberships
        SET role = ?
        WHERE user_id = ?
          AND company_id = ?
        `,
    ).run(role, userId, companyId);

    return true;
}

export function removeMember(companyId: number, userId: number) {
    if (!membershipRole(userId, companyId)) {
        return false;
    }

    assertDispatcherRemains(companyId, userId, null);
    stmt(
        `
        DELETE FROM company_memberships
        WHERE user_id = ?
          AND company_id = ?
        `,
    ).run(userId, companyId);
    stmt(
        `
        DELETE FROM sessions
        WHERE user_id = ?
          AND company_id = ?
        `,
    ).run(userId, companyId);

    return true;
}

export function createCompanyForUser(userId: number, name: string): number {
    return withTransaction(() => {
        if (companyByName(name)) {
            throw new ConflictError("Firmenname ist bereits vergeben.", {
                company_name: "Firmenname ist bereits vergeben.",
            });
        }

        const companyId = insertCompany(name);
        stmt(
            `
            INSERT INTO company_memberships (user_id, company_id, role)
            VALUES (?, ?, 'dispatcher')
            `,
        ).run(userId, companyId);

        return companyId;
    });
}

export function dismissImportPrompt(companyId: number) {
    stmt(
        `
        UPDATE companies
        SET import_prompt_dismissed_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
    ).run(companyId);
}

export function companySecurity(companyId: number): CompanySecurityRow | undefined {
    return stmt(
        `
        SELECT id, name, totp_required, sso_required, sso_issuer,
               sso_client_id, sso_client_secret
        FROM companies
        WHERE id = ?
        `,
    ).get(companyId) as CompanySecurityRow | undefined;
}

export function publicSecurity(companyId: number) {
    const row = companySecurity(companyId);

    if (!row) {
        return undefined;
    }

    return {
        totp_required: row.totp_required === 1,
        sso_required: row.sso_required === 1,
        sso_issuer: row.sso_issuer,
        sso_client_id: row.sso_client_id,
        sso_configured: Boolean(row.sso_issuer && row.sso_client_id),
    };
}

export function updateSecurity(companyId: number, input: SecurityInput) {
    const current = companySecurity(companyId);

    if (!current) {
        throw new ValidationError("Firma nicht gefunden.");
    }

    const issuer =
        input.sso_issuer === undefined ? current.sso_issuer : input.sso_issuer;
    const clientId =
        input.sso_client_id === undefined
            ? current.sso_client_id
            : input.sso_client_id;
    let secret = current.sso_client_secret;

    if (input.sso_client_secret) {
        secret = seal(input.sso_client_secret);
    } else if (input.sso_client_secret === null) {
        secret = null;
    }

    const ssoRequired = input.sso_required ?? current.sso_required === 1;

    if (ssoRequired && !issuer) {
        throw new ValidationError("Für den Firmen-Login braucht es einen Issuer.", {
            sso_issuer: "Für den Firmen-Login braucht es einen Issuer.",
        });
    }

    stmt(
        `
        UPDATE companies
        SET totp_required = ?,
            sso_required = ?,
            sso_issuer = ?,
            sso_client_id = ?,
            sso_client_secret = ?
        WHERE id = ?
        `,
    ).run(
        (input.totp_required ?? current.totp_required === 1) ? 1 : 0,
        ssoRequired ? 1 : 0,
        issuer,
        clientId,
        secret,
        companyId,
    );
}

export function ssoClient(companyId: number): {
    issuer: string;
    clientId: string;
    clientSecret: string;
} | undefined {
    const row = companySecurity(companyId);

    if (!row?.sso_issuer || !row.sso_client_id || !row.sso_client_secret) {
        return undefined;
    }

    return {
        issuer: row.sso_issuer,
        clientId: row.sso_client_id,
        clientSecret: open(row.sso_client_secret),
    };
}

export function pickLoginCompany(userId: number) {
    const rows = listMemberships(userId);
    return rows.find((row) => row.sso_required === 0) ?? rows[0];
}

export function replaceRecoveryCodes(userId: number, codes: string[]) {
    stmt("DELETE FROM totp_recovery_codes WHERE user_id = ?").run(userId);

    const insert = stmt(
        `
        INSERT INTO totp_recovery_codes (user_id, code_hash)
        VALUES (?, ?)
        `,
    );

    for (const code of codes) {
        insert.run(userId, hashToken(normalizeRecoveryCode(code)));
    }
}

export function consumeRecoveryCode(userId: number, code: string): boolean {
    const row = stmt(
        `
        SELECT id
        FROM totp_recovery_codes
        WHERE user_id = ?
          AND code_hash = ?
          AND used_at IS NULL
        `,
    ).get(userId, hashToken(normalizeRecoveryCode(code))) as
        | { id: number }
        | undefined;

    if (!row) {
        return false;
    }

    stmt("DELETE FROM totp_recovery_codes WHERE user_id = ?").run(userId);
    UserModel.setTotp(userId, null, false);
    return true;
}

function normalizeRecoveryCode(code: string): string {
    return code.replace(/\s/g, "").toLowerCase();
}

export function findSsoUser(provider: string, subject: string): UserRecord | undefined {
    const row = stmt(
        `
        SELECT user_id
        FROM sso_identities
        WHERE provider = ?
          AND subject = ?
        `,
    ).get(provider, subject) as { user_id: number } | undefined;

    return row ? UserModel.getById(row.user_id) : undefined;
}

export function linkSsoIdentity(
    user: UserRecord,
    provider: string,
    subject: string,
    emailVerifiedByIdp: boolean,
): UserRecord | undefined {
    if (!emailVerifiedByIdp) {
        return undefined;
    }

    if (!user.email_verified_at && user.password_hash) {
        return undefined;
    }

    stmt(
        `
        INSERT OR IGNORE INTO sso_identities (user_id, provider, subject)
        VALUES (?, ?, ?)
        `,
    ).run(user.id, provider, subject);
    UserModel.markEmailVerified(user.id);

    return UserModel.getById(user.id);
}

export function authUserFor(userId: number, companyId: number) {
    const user = UserModel.getById(userId);

    if (!user) {
        return undefined;
    }

    return presentUser(user, companyId);
}
