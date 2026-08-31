import type { DatabaseSync } from "node:sqlite";
import type { UserRole } from "@fleet-live/shared";
import { hashPassword } from "../lib/password";

export const DEV_PASSWORD = "development-only-password";

const DEV_USERS: Array<{
    name: string;
    email: string;
    company_id: number;
    role: UserRole;
}> = [
    {
        name: "Cihan Kurt",
        email: "cihan@example.com",
        company_id: 1,
        role: "dispatcher",
    },
    {
        name: "Viewer",
        email: "viewer@example.com",
        company_id: 1,
        role: "viewer",
    },
];

/** Demo-Logins für lokale DBs, die vor dem Viewer-Konto geseedet wurden. */
export function ensureDevAccounts(database: DatabaseSync) {
    const find = database.prepare("SELECT id FROM users WHERE email = ?");
    const insert = database.prepare(`
        INSERT INTO users (name, email, password_hash, company_id, role)
        VALUES (?, ?, ?, ?, ?)
    `);

    for (const user of DEV_USERS) {
        if (find.get(user.email)) {
            continue;
        }

        insert.run(
            user.name,
            user.email,
            hashPassword(DEV_PASSWORD),
            user.company_id,
            user.role,
        );
    }
}

export function upsertDevAccounts(database: DatabaseSync) {
    const insertUser = database.prepare(`
        INSERT INTO users (
            name,
            email,
            password_hash,
            company_id,
            role
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
            name = excluded.name,
            password_hash = excluded.password_hash,
            company_id = excluded.company_id,
            role = excluded.role
    `);
    const passwordHash = hashPassword(DEV_PASSWORD);

    for (const user of DEV_USERS) {
        insertUser.run(
            user.name,
            user.email,
            passwordHash,
            user.company_id,
            user.role,
        );
    }
}
