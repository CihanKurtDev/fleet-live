import { z } from "zod";
import { USER_ROLE_LABELS, type UserRole } from "./auth";

/** Changes to who may do what in a company, kept for its dispatchers (`GET /api/auth/audit`). */
export const AUDIT_ACTIONS = [
    "company_created",
    "invite_created",
    "invite_withdrawn",
    "invite_accepted",
    "invite_declined",
    "member_role_changed",
    "member_removed",
    "member_left",
    "security_changed",
    "sso_linked",
    "domain_added",
    "domain_verified",
    "domain_removed",
    "retention_changed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** What a change to the company's sign-in rules did, in the order it is told. */
export const SECURITY_CHANGES = [
    "totp_required_on",
    "totp_required_off",
    "sso_required_on",
    "sso_required_off",
    "sso_settings",
    "sso_secret",
] as const;

export type SecurityChange = (typeof SECURITY_CHANGES)[number];

export type AuditDetails = {
    /** The role an invitation offers or a membership got. */
    role?: UserRole;
    /** A role change: before and after. */
    from?: UserRole;
    to?: UserRole;
    changes?: SecurityChange[];
    /** The company domain of a domain_* entry. */
    domain?: string;
    /** New retention days of a retention_changed entry; null = default. */
    retention?: Partial<Record<"trips" | "alerts" | "audit", number | null>>;
};

export type AuditEvent = {
    id: number;
    created_at: string;
    action: AuditAction;
    /** Names as they were at the time; the account may be gone or renamed since. */
    actor_name: string | null;
    target_name: string | null;
    target_email: string | null;
    details: AuditDetails | null;
};

export const AUDIT_PAGE_LIMIT = 50;

const auditListQuerySchema = z.object({
    page: z.coerce
        .number()
        .int("Seite muss eine ganze Zahl sein.")
        .min(1, "Seite muss mindestens 1 sein.")
        .default(1),
});

export function parseAuditListQuery(input: unknown): { page: number } {
    return auditListQuerySchema.parse(input);
}

const SECURITY_CHANGE_TEXT: Record<SecurityChange, string> = {
    totp_required_on: "Zwei-Faktor für alle verlangt",
    totp_required_off: "Zwei-Faktor nicht mehr verlangt",
    sso_required_on: "Firmen-Login verlangt",
    sso_required_off: "Firmen-Login nicht mehr verlangt",
    sso_settings: "Firmen-Login-Daten geändert",
    sso_secret: "Client-Geheimnis ersetzt",
};

const RETENTION_NAMES = { trips: "Fahrten", alerts: "Warnungen", audit: "Protokoll" } as const;

const role = (value: UserRole | undefined) => (value ? USER_ROLE_LABELS[value] : "?");

/** The person a change was about: name and address, or what is left of them. */
const whom = (event: AuditEvent) => {
    if (event.target_name && event.target_email) {
        return `${event.target_name} (${event.target_email})`;
    }

    return event.target_email ?? event.target_name ?? "eine Person";
};

/** One line for the log; who did it stands in its own column. */
export function formatAuditEvent(event: AuditEvent): string {
    const details = event.details ?? {};

    switch (event.action) {
        case "company_created":
            return "Firma angelegt";
        case "invite_created":
            return `${event.target_email ?? whom(event)} als ${role(details.role)} eingeladen`;
        case "invite_withdrawn":
            return `Einladung an ${event.target_email ?? whom(event)} zurückgezogen`;
        case "invite_accepted":
            return `Einladung angenommen, Rolle ${role(details.role)}`;
        case "invite_declined":
            return "Einladung abgelehnt";
        case "member_role_changed":
            return `Rolle von ${whom(event)}: ${role(details.from)} → ${role(details.to)}`;
        case "member_removed":
            return `${whom(event)} entfernt`;
        case "member_left":
            return "Firma verlassen";
        case "security_changed":
            return (details.changes ?? []).map((change) => SECURITY_CHANGE_TEXT[change]).join(", ") ||
                "Anmelde-Einstellungen gespeichert";
        case "sso_linked":
            return "Konto mit dem Firmen-Login verknüpft";
        case "domain_added":
            return `Domain ${details.domain ?? "?"} eingetragen`;
        case "domain_verified":
            return `Domain ${details.domain ?? "?"} bestätigt`;
        case "domain_removed":
            return `Domain ${details.domain ?? "?"} entfernt`;
        case "retention_changed":
            return `Aufbewahrung geändert: ${Object.entries(details.retention ?? {})
                .map(([kind, days]) => `${RETENTION_NAMES[kind as keyof typeof RETENTION_NAMES]} ${days === null ? "Standard" : `${days} Tage`}`)
                .join(", ")}`;
    }
}
