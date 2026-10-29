import type { SecurityInput, UserRole } from "@fleet-live/shared";
import { withTransaction } from "../db/database";
import { stmt } from "../db/statements";
import {
    ConflictError,
    ForbiddenError,
    ValidationError,
} from "../lib/errors";
import { assertSafeIssuer, issuerMatches } from "../lib/oidc";
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

/**
 * Registers a company with its first dispatcher. An address that already has
 * an account comes back as `existing`, untouched: the answer to the visitor
 * must not tell the two apart (the controller mails the owner instead).
 */
export function registerAccount(input: {
    company_name: string;
    name: string;
    email: string;
    password: string;
}): { user: UserRecord; existing: boolean } {
    return withTransaction(() => {
        const existing = UserModel.findByEmail(input.email);

        if (existing) {
            return { user: existing, existing: true };
        }

        if (companyByName(input.company_name)) {
            throw new ConflictError("Firmenname ist bereits vergeben.", {
                company_name: "Firmenname ist bereits vergeben.",
            });
        }

        const companyId = insertCompany(input.company_name);
        const user = UserModel.create({
            name: input.name,
            email: input.email,
            password: input.password,
            company_id: companyId,
            role: "dispatcher",
            verified: false,
        });

        return { user, existing: false };
    });
}

export function verifyEmailToken(token: string): boolean {
    const row = AuthTokenModel.claim(token, "verify_email");

    if (row?.user_id) {
        UserModel.markEmailVerified(row.user_id);
        return true;
    }

    const used = AuthTokenModel.findUsed(token, "verify_email");

    if (!used?.user_id) {
        return false;
    }

    return Boolean(UserModel.getById(used.user_id)?.email_verified_at);
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

/** Sets a new password with a reset link; returns whose, or nothing for a bad link. */
export function resetPassword(token: string, password: string): number | undefined {
    const row = AuthTokenModel.claim(token, "reset_password");

    if (!row?.user_id) {
        return undefined;
    }

    UserModel.setPasswordHash(row.user_id, hashPassword(password));
    UserModel.markEmailVerified(row.user_id);
    // Every session ends, and so does every other open reset link.
    SessionModel.deleteForUser(row.user_id);
    AuthTokenModel.deleteForUser(row.user_id, "reset_password");
    return row.user_id;
}

/** An account nobody has signed in to yet: it was created by an invitation. */
function neverActivated(user: UserRecord): boolean {
    return user.password_hash === null && user.email_verified_at === null;
}

function pendingInvite(companyId: number, userId: number) {
    return stmt(
        "SELECT role FROM company_invites WHERE company_id = ? AND user_id = ?",
    ).get(companyId, userId) as { role: UserRole } | undefined;
}

/**
 * Invites a person into a company. It never makes them a member: the invitation
 * waits until they accept it. `activate` says the account has no password yet,
 * so the mail must carry the link that sets one.
 */
export function inviteMember(
    companyId: number,
    email: string,
    role: UserRole,
    invitedBy: number,
): { user: UserRecord; activate: boolean } {
    return withTransaction(() => {
        const user =
            UserModel.findByEmail(email) ??
            UserModel.create({
                name: email.split("@")[0] || "Eingeladen",
                email,
                password: null,
                company_id: null,
                verified: false,
            });

        if (membershipRole(user.id, companyId)) {
            throw new ConflictError("Diese Person ist schon in der Firma.", {
                email: "Diese Person ist schon in der Firma.",
            });
        }

        if (pendingInvite(companyId, user.id)) {
            throw new ConflictError("Diese Person ist schon eingeladen.", {
                email: "Diese Person ist schon eingeladen.",
            });
        }

        stmt(
            `
            INSERT INTO company_invites (company_id, user_id, role, invited_by)
            VALUES (?, ?, ?, ?)
            `,
        ).run(companyId, user.id, role, invitedBy);

        return { user, activate: neverActivated(user) };
    });
}

/** Turns the invitation into a membership, with the role it was sent with. */
function joinFromInvite(userId: number, companyId: number): boolean {
    const invite = pendingInvite(companyId, userId);

    if (!invite) {
        return false;
    }

    stmt(
        `
        INSERT INTO company_memberships (user_id, company_id, role)
        VALUES (?, ?, ?)
        ON CONFLICT (user_id, company_id) DO NOTHING
        `,
    ).run(userId, companyId, invite.role);
    stmt("DELETE FROM company_invites WHERE company_id = ? AND user_id = ?").run(
        companyId,
        userId,
    );
    return true;
}

/** The link in the invitation mail: sets name and password and accepts that invitation. */
export function acceptInvite(input: {
    token: string;
    name: string;
    password: string;
}): { userId: number; companyId: number } | undefined {
    return withTransaction(() => {
        const row = AuthTokenModel.claim(input.token, "invite");

        // A withdrawn invitation leaves its link without anything to accept.
        if (!row?.user_id || !row.company_id || !joinFromInvite(row.user_id, row.company_id)) {
            return undefined;
        }

        UserModel.setName(row.user_id, input.name);
        UserModel.setPasswordHash(row.user_id, hashPassword(input.password));
        UserModel.markEmailVerified(row.user_id);

        return { userId: row.user_id, companyId: row.company_id };
    });
}

export type InvitationRow = {
    company_id: number;
    company_name: string;
    role: UserRole;
    invited_by_name: string | null;
    created_at: string;
};

/** Invitations waiting for this person, oldest first. */
export function listInvitations(userId: number): InvitationRow[] {
    return stmt(
        `
        SELECT i.company_id, c.name AS company_name, i.role,
               inviter.name AS invited_by_name, i.created_at
        FROM company_invites i
        JOIN companies c ON c.id = i.company_id
        LEFT JOIN users inviter ON inviter.id = i.invited_by
        WHERE i.user_id = ?
        ORDER BY i.created_at, i.id
        `,
    ).all(userId) as InvitationRow[];
}

/** The signed-in person accepts; false when there is no such invitation. */
export function acceptInvitation(userId: number, companyId: number): boolean {
    return withTransaction(() => joinFromInvite(userId, companyId));
}

/** The signed-in person declines; false when there is no such invitation. */
export function declineInvitation(userId: number, companyId: number): boolean {
    const result = stmt(
        "DELETE FROM company_invites WHERE company_id = ? AND user_id = ?",
    ).run(companyId, userId);

    return Number(result.changes) > 0;
}

/** The company takes its invitation back; its mail link then accepts nothing. */
export function withdrawInvite(companyId: number, userId: number): boolean {
    return withTransaction(() => {
        const result = stmt(
            "DELETE FROM company_invites WHERE company_id = ? AND user_id = ?",
        ).run(companyId, userId);

        AuthTokenModel.deleteInvites(userId, companyId);
        return Number(result.changes) > 0;
    });
}

export type MemberRow = {
    user_id: number;
    name: string;
    email: string;
    role: UserRole;
    /** Invited and not accepted yet: no access to the company. */
    invited: boolean;
};

/** Members first, then open invitations; each group by name. */
export function listMembers(companyId: number): MemberRow[] {
    const rows = stmt(
        `
        SELECT u.id AS user_id, u.name, u.email, m.role, 0 AS invited
        FROM company_memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.company_id = ?
        UNION ALL
        SELECT u.id AS user_id, u.name, u.email, i.role, 1 AS invited
        FROM company_invites i
        JOIN users u ON u.id = i.user_id
        WHERE i.company_id = ?
        ORDER BY invited, name COLLATE NOCASE
        `,
    ).all(companyId, companyId) as (Omit<MemberRow, "invited"> & { invited: number })[];

    return rows.map((row) => ({ ...row, invited: row.invited === 1 }));
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
        sso_configured: Boolean(
            row.sso_issuer && row.sso_client_id && row.sso_client_secret,
        ),
        sso_secret_set: Boolean(row.sso_client_secret),
    };
}

export function updateSecurity(companyId: number, input: SecurityInput) {
    const current = companySecurity(companyId);

    if (!current) {
        throw new ValidationError("Firma nicht gefunden.");
    }

    const issuer =
        input.sso_issuer === undefined ? current.sso_issuer : input.sso_issuer;

    // The server fetches this URL; it must not point into its own network.
    if (input.sso_issuer) {
        assertSafeIssuer(input.sso_issuer);
    }
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

    // A changed identity provider is not the one the members linked. While the
    // company requires its login, that would lock everyone out.
    if (
        ssoRequired &&
        (issuer !== current.sso_issuer ||
            clientId !== current.sso_client_id ||
            secret !== current.sso_client_secret)
    ) {
        throw new ConflictError(
            "Schalte „Firmen-Login verlangen“ aus, bevor du den Firmen-Login änderst.",
        );
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

    // One code, once. The second factor stays: switching it off here left the
    // account without one until someone noticed. A new authenticator is set
    // up in the account, which also issues new codes.
    const result = stmt(
        "UPDATE totp_recovery_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL",
    ).run(row.id);

    return Number(result.changes) === 1;
}

function normalizeRecoveryCode(code: string): string {
    return code.replace(/\s/g, "").toLowerCase();
}

/**
 * The account an external login belongs to. Only an identity linked by its
 * owner counts: issuer and subject of the validated token, through the same
 * provider it was linked with. The e-mail of the provider plays no part.
 */
export function findSsoUser(
    provider: string,
    issuer: string,
    subject: string,
): UserRecord | undefined {
    const row = stmt(
        `
        SELECT user_id
        FROM sso_identities
        WHERE provider = ?
          AND issuer = ?
          AND subject = ?
        `,
    ).get(provider, issuer, subject) as { user_id: number } | undefined;

    return row ? UserModel.getById(row.user_id) : undefined;
}

/**
 * Whether the person has linked this provider. With `issuer`, only a link
 * to that issuer counts: a link to an earlier company login does not sign in
 * through the current one.
 */
export function hasSsoIdentity(
    userId: number,
    provider: string,
    issuer?: string | null,
): boolean {
    const rows = stmt(
        "SELECT issuer FROM sso_identities WHERE user_id = ? AND provider = ?",
    ).all(userId, provider) as { issuer: string }[];

    return issuer === undefined
        ? rows.length > 0
        : Boolean(issuer) && rows.some((row) => issuerMatches(issuer ?? "", row.issuer));
}

/**
 * Links an external login to the signed-in owner. An identity that already
 * belongs to another account stays there (`taken`), whichever provider it was
 * linked with; linking the same one twice is a no-op.
 */
export function linkSsoIdentity(input: {
    userId: number;
    provider: string;
    issuer: string;
    subject: string;
}): "linked" | "taken" {
    return withTransaction(() => {
        const other = stmt(
            `
            SELECT user_id
            FROM sso_identities
            WHERE issuer = ?
              AND subject = ?
              AND user_id <> ?
            LIMIT 1
            `,
        ).get(input.issuer, input.subject, input.userId);

        if (other) {
            return "taken";
        }

        stmt(
            `
            INSERT OR IGNORE INTO sso_identities (user_id, provider, issuer, subject)
            VALUES (?, ?, ?, ?)
            `,
        ).run(input.userId, input.provider, input.issuer, input.subject);

        return "linked";
    });
}

/** The person's own link to Google or Microsoft; false when there was none. */
export function unlinkSsoIdentity(userId: number, provider: "google" | "microsoft"): boolean {
    const result = stmt(
        "DELETE FROM sso_identities WHERE user_id = ? AND provider = ?",
    ).run(userId, provider);

    return Number(result.changes) > 0;
}

export function authUserFor(userId: number, companyId: number) {
    const user = UserModel.getById(userId);

    if (!user) {
        return undefined;
    }

    return presentUser(user, companyId);
}
