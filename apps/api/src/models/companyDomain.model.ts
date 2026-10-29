import { randomBytes } from "node:crypto";
import {
    DOMAIN_RECORD_PREFIX,
    DOMAIN_RECORD_VALUE_PREFIX,
    emailDomain,
    type CompanyDomain,
} from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { ConflictError } from "../lib/errors";

type DomainRow = {
    id: number;
    company_id: number;
    domain: string;
    token: string;
    verified_at: string | null;
};

const present = (row: DomainRow): CompanyDomain => ({
    id: row.id,
    domain: row.domain,
    verified_at: row.verified_at,
    record_name: `${DOMAIN_RECORD_PREFIX}.${row.domain}`,
    record_value: `${DOMAIN_RECORD_VALUE_PREFIX}${row.token}`,
});

function verifiedElsewhere(domain: string, companyId: number): boolean {
    return Boolean(
        stmt(
            "SELECT 1 FROM company_domains WHERE domain = ? AND company_id <> ? AND verified_at IS NOT NULL",
        ).get(domain, companyId),
    );
}

const TAKEN = "Diese Domain hat schon eine andere Firma bestätigt.";

export const CompanyDomainModel = {
    list(companyId: number): CompanyDomain[] {
        return (
            stmt(
                "SELECT id, company_id, domain, token, verified_at FROM company_domains WHERE company_id = ? ORDER BY domain",
            ).all(companyId) as DomainRow[]
        ).map(present);
    },

    find(companyId: number, id: number): (CompanyDomain & { token: string }) | undefined {
        const row = stmt(
            "SELECT id, company_id, domain, token, verified_at FROM company_domains WHERE company_id = ? AND id = ?",
        ).get(companyId, id) as DomainRow | undefined;

        return row ? { ...present(row), token: row.token } : undefined;
    },

    add(companyId: number, domain: string): CompanyDomain {
        if (verifiedElsewhere(domain, companyId)) {
            throw new ConflictError(TAKEN, { domain: TAKEN });
        }

        const exists = stmt(
            "SELECT 1 FROM company_domains WHERE company_id = ? AND domain = ?",
        ).get(companyId, domain);

        if (exists) {
            const message = "Diese Domain ist schon eingetragen.";
            throw new ConflictError(message, { domain: message });
        }

        const result = stmt(
            "INSERT INTO company_domains (company_id, domain, token) VALUES (?, ?, ?)",
        ).run(companyId, domain, randomBytes(16).toString("hex"));
        const created = this.find(companyId, Number(result.lastInsertRowid));

        if (!created) {
            throw new Error("Created domain was not found.");
        }

        const { token: _token, ...domainRow } = created;
        return domainRow;
    },

    markVerified(companyId: number, id: number, domain: string) {
        if (verifiedElsewhere(domain, companyId)) {
            throw new ConflictError(TAKEN, { domain: TAKEN });
        }

        stmt(
            "UPDATE company_domains SET verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP) WHERE company_id = ? AND id = ?",
        ).run(companyId, id);
    },

    remove(companyId: number, id: number): boolean {
        const result = stmt(
            "DELETE FROM company_domains WHERE company_id = ? AND id = ?",
        ).run(companyId, id);

        return Number(result.changes) > 0;
    },

    /**
     * The company whose login an e-mail address leads to: its domain is
     * confirmed by exactly one company, and that company has a login set up.
     */
    companyForEmail(email: string): number | undefined {
        const row = stmt(
            `
            SELECT c.id
            FROM company_domains d
            JOIN companies c ON c.id = d.company_id
            WHERE d.domain = ?
              AND d.verified_at IS NOT NULL
              AND c.sso_issuer IS NOT NULL
              AND c.sso_client_id IS NOT NULL
              AND c.sso_client_secret IS NOT NULL
            `,
        ).get(emailDomain(email)) as { id: number } | undefined;

        return row?.id;
    },
};
