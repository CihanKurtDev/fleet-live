import { z } from "zod";

/**
 * A domain a company proves it owns with a DNS TXT record. The company login
 * on the sign-in page is found by the domain of the e-mail, and only for a
 * confirmed domain, so the answer never depends on who is a member where.
 */
export type CompanyDomain = {
    id: number;
    domain: string;
    verified_at: string | null;
    /** Where the TXT record goes, e.g. `_fleet-live.firma.de`. */
    record_name: string;
    record_value: string;
};

export const DOMAIN_RECORD_PREFIX = "_fleet-live";
export const DOMAIN_RECORD_VALUE_PREFIX = "fleet-live-verification=";

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const domainSchema = z.object({
    domain: z
        .string({ error: "Domain fehlt." })
        .trim()
        .toLowerCase()
        .max(253, "Die Domain ist zu lang.")
        .regex(DOMAIN_PATTERN, "Gib eine Domain wie firma.de an, ohne https:// und ohne @."),
});

export function parseDomainInput(input: unknown): { domain: string } {
    return domainSchema.parse(input);
}

/** The domain part of an e-mail address, lowercase; empty without an @. */
export function emailDomain(email: string): string {
    const at = email.lastIndexOf("@");
    return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
}
