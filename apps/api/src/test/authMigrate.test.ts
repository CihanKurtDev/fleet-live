import "./env";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { ensureAuthHardening } from "../db/migrate";

/** The sign-in tables as they were before v23. */
function legacyAuth(): DatabaseSync {
    const database = new DatabaseSync(":memory:");
    database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE);
        INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com');

        CREATE TABLE sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            company_id INTEGER NOT NULL,
            token TEXT NOT NULL UNIQUE,
            persistent INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at TEXT NOT NULL
        );
        INSERT INTO sessions (user_id, company_id, token, expires_at)
        VALUES (1, 1, 'hash-1', datetime('now', '+1 day'));

        CREATE TABLE auth_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            purpose TEXT NOT NULL CHECK (purpose IN (
                'verify_email', 'reset_password', 'invite',
                'login_challenge', 'totp_setup', 'sso_state'
            )),
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            company_id INTEGER,
            role TEXT,
            payload TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
        VALUES (1, 'reset_password', 'tok-1', datetime('now', '+1 hour'));

        CREATE TABLE sso_identities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            provider TEXT NOT NULL,
            subject TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE (provider, subject)
        );
        INSERT INTO sso_identities (user_id, provider, subject) VALUES
            (1, 'google', 'g-1'),
            (2, 'company:3', 'c-2');
    `);

    return database;
}

const plain = <T extends object>(rows: unknown[]) => rows.map((row) => ({ ...(row as T) }));

describe("the v23 sign-in migration", () => {
    it("moves links made by e-mail aside instead of trusting them", () => {
        const database = legacyAuth();
        ensureAuthHardening(database);

        assert.deepEqual(
            plain(database.prepare("SELECT * FROM sso_identities").all()),
            [],
        );
        assert.deepEqual(
            plain(
                database
                    .prepare("SELECT user_id, provider, subject FROM sso_identities_legacy ORDER BY id")
                    .all(),
            ),
            [
                { user_id: 1, provider: "google", subject: "g-1" },
                { user_id: 2, provider: "company:3", subject: "c-2" },
            ],
        );
    });

    it("keys new links by issuer and subject and refuses empty ones", () => {
        const database = legacyAuth();
        ensureAuthHardening(database);
        const insert = database.prepare(
            "INSERT INTO sso_identities (user_id, provider, issuer, subject) VALUES (?, ?, ?, ?)",
        );

        insert.run(1, "google", "https://accounts.google.com", "g-1");
        assert.throws(() => insert.run(2, "google", "https://accounts.google.com", "g-1"), /UNIQUE/);
        assert.throws(() => insert.run(2, "google", "", "x"), /CHECK/);
        assert.throws(() => insert.run(2, "google", "https://accounts.google.com", ""), /CHECK/);
    });

    it("keeps the open tokens and accepts the link step", () => {
        const database = legacyAuth();
        ensureAuthHardening(database);

        assert.equal(
            (database.prepare("SELECT COUNT(*) AS n FROM auth_tokens WHERE token_hash = 'tok-1'").get() as { n: number }).n,
            1,
        );
        database
            .prepare(
                "INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (1, 'sso_link', 'tok-2', datetime('now'))",
            )
            .run();
    });

    it("marks existing sessions as without second factor and company login", () => {
        const database = legacyAuth();
        ensureAuthHardening(database);

        assert.deepEqual(
            plain(database.prepare("SELECT mfa, sso_company_id FROM sessions").all()),
            [{ mfa: 0, sso_company_id: null }],
        );
    });

    it("can run again without changing anything", () => {
        const database = legacyAuth();
        ensureAuthHardening(database);
        database
            .prepare(
                "INSERT INTO sso_identities (user_id, provider, issuer, subject) VALUES (1, 'google', 'https://accounts.google.com', 'g-9')",
            )
            .run();
        ensureAuthHardening(database);

        assert.equal(
            (database.prepare("SELECT COUNT(*) AS n FROM sso_identities").get() as { n: number }).n,
            1,
        );
        assert.equal(
            (database.prepare("SELECT COUNT(*) AS n FROM sso_identities_legacy").get() as { n: number }).n,
            2,
        );
    });
});
