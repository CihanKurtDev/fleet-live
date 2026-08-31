import type { AuthUser } from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { db } from "../db/database";
import { hashPassword } from "../lib/password";

type UserRow = AuthUser & { password_hash: string };

const SELECT_PUBLIC = `
    SELECT id, name, email, company_id, role
    FROM users
    WHERE id = ?
`;

const SELECT_BY_EMAIL = `
    SELECT id, name, email, company_id, role, password_hash
    FROM users
    WHERE email = ?
`;

const INSERT_USER = `
    INSERT INTO users (name, email, password_hash, company_id, role)
    VALUES (?, ?, ?, ?, ?)
`;

const UPDATE_PASSWORD = `
    UPDATE users
    SET password_hash = ?
    WHERE id = ?
`;

export const UserModel = {
    getById(id: number): AuthUser | undefined {
        return stmt(SELECT_PUBLIC).get(id) as AuthUser | undefined;
    },

    findByEmail(email: string): UserRow | undefined {
        return stmt(SELECT_BY_EMAIL).get(email) as UserRow | undefined;
    },

    create(input: {
        name: string;
        email: string;
        password: string;
        company_id: number;
        role?: AuthUser["role"];
    }): AuthUser {
        const result = stmt(INSERT_USER).run(
            input.name,
            input.email,
            hashPassword(input.password),
            input.company_id,
            input.role ?? "dispatcher",
        );

        const created = this.getById(Number(result.lastInsertRowid));

        if (!created) {
            throw new Error("Created user was not found.");
        }

        return created;
    },

    setPasswordHash(id: number, passwordHash: string) {
        stmt(UPDATE_PASSWORD).run(passwordHash, id);
    },

    resetForTests() {
        db.exec("DELETE FROM sessions");
        db.exec("DELETE FROM users");
        db.exec(
            "DELETE FROM sqlite_sequence WHERE name IN ('users', 'sessions')",
        );
    },
};
