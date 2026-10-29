import type { UserRole } from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { db } from "../db/database";
import { hashPassword } from "../lib/password";
import { resetLoginAttemptsForTests } from "../lib/loginAttempts";
import { resetTotpAttemptsForTests } from "../lib/totpAttempts";

export type UserRecord = {
    id: number;
    name: string;
    email: string;
    password_hash: string | null;
    email_verified_at: string | null;
    totp_secret: string | null;
    totp_enabled: number;
    /** Last accepted TOTP time step; a code counts once. */
    totp_last_step: number | null;
};

const SELECT_BY_EMAIL = `
    SELECT id, name, email, password_hash, email_verified_at, totp_secret, totp_enabled,
           totp_last_step
    FROM users
    WHERE email = ?
`;

const SELECT_BY_ID = `
    SELECT id, name, email, password_hash, email_verified_at, totp_secret, totp_enabled,
           totp_last_step
    FROM users
    WHERE id = ?
`;

export const UserModel = {
    getById(id: number): UserRecord | undefined {
        return stmt(SELECT_BY_ID).get(id) as UserRecord | undefined;
    },

    findByEmail(email: string): UserRecord | undefined {
        return stmt(SELECT_BY_EMAIL).get(email.trim().toLowerCase()) as
            | UserRecord
            | undefined;
    },

    create(input: {
        name: string;
        email: string;
        password: string | null;
        /** Without a company the account starts with no membership (an invitee). */
        company_id: number | null;
        role?: UserRole;
        verified?: boolean;
    }): UserRecord {
        const email = input.email.trim().toLowerCase();
        const result = stmt(
            `
            INSERT INTO users (name, email, password_hash, email_verified_at)
            VALUES (?, ?, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END)
            `,
        ).run(
            input.name.trim(),
            email,
            input.password ? hashPassword(input.password) : null,
            input.verified === false ? 0 : 1,
        );
        const id = Number(result.lastInsertRowid);

        if (input.company_id !== null) {
            stmt(
                `
                INSERT INTO company_memberships (user_id, company_id, role)
                VALUES (?, ?, ?)
                `,
            ).run(id, input.company_id, input.role ?? "dispatcher");
        }

        const created = this.getById(id);

        if (!created) {
            throw new Error("Created user was not found.");
        }

        return created;
    },

    setPasswordHash(id: number, passwordHash: string) {
        stmt("UPDATE users SET password_hash = ? WHERE id = ?").run(
            passwordHash,
            id,
        );
    },

    markEmailVerified(id: number) {
        stmt(
            `
            UPDATE users
            SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP)
            WHERE id = ?
            `,
        ).run(id);
    },

    setName(id: number, name: string) {
        stmt("UPDATE users SET name = ? WHERE id = ?").run(name.trim(), id);
    },

    setTotp(id: number, secret: string | null, enabled: boolean) {
        // A new secret starts its own sequence of time steps.
        stmt(
            "UPDATE users SET totp_secret = ?, totp_enabled = ?, totp_last_step = NULL WHERE id = ?",
        ).run(secret, enabled ? 1 : 0, id);
    },

    setTotpLastStep(id: number, step: number) {
        stmt("UPDATE users SET totp_last_step = ? WHERE id = ?").run(step, id);
    },

    resetForTests() {
        resetTotpAttemptsForTests();
        resetLoginAttemptsForTests();
        db.exec("DELETE FROM import_runs");
        db.exec("DELETE FROM sso_identities");
        db.exec("DELETE FROM totp_recovery_codes");
        db.exec("DELETE FROM auth_tokens");
        db.exec("DELETE FROM sessions");
        db.exec("DELETE FROM company_invites");
        db.exec("DELETE FROM audit_events");
        db.exec("DELETE FROM company_domains");
        db.exec("DELETE FROM company_memberships");
        db.exec("DELETE FROM users");
        db.exec(
            `
            UPDATE companies
            SET import_prompt_dismissed_at = NULL,
                totp_required = 0,
                sso_issuer = NULL,
                sso_client_id = NULL,
                sso_client_secret = NULL,
                sso_required = 0,
                trip_retention_days = NULL,
                alert_retention_days = NULL,
                audit_retention_days = NULL,
                viewer_driver_names = 1
            `,
        );
        db.exec(
            "DELETE FROM sqlite_sequence WHERE name IN ('users', 'sessions', 'company_memberships', 'company_invites', 'audit_events', 'auth_tokens')",
        );
    },
};
