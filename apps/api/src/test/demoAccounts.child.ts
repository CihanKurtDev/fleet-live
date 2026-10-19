/**
 * Runs as a child process with a file database: the demo accounts are only
 * considered for a database that lives in a file.
 */
import { db } from "../db/database";

const row = db
    .prepare(
        "SELECT COUNT(*) AS n FROM users WHERE email IN ('cihan@example.com', 'viewer@example.com')",
    )
    .get() as { n: number };

console.log(`demo-accounts: ${row.n}`);
