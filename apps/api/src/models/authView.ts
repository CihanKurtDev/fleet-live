import type { AuthUser, MembershipSummary, UserRole } from "@fleet-live/shared";
import { stmt } from "../db/statements";

type MembershipRow = {
    company_id: number;
    company_name: string;
    role: UserRole;
    import_prompt_dismissed_at: string | null;
    totp_required: number;
    sso_required: number;
    vehicle_count: number;
};

const MEMBERSHIPS = `
    SELECT
        m.company_id,
        c.name AS company_name,
        m.role,
        c.import_prompt_dismissed_at,
        c.totp_required,
        c.sso_required,
        (
            SELECT COUNT(*)
            FROM vehicles v
            WHERE v.company_id = c.id
        ) AS vehicle_count
    FROM company_memberships m
    JOIN companies c ON c.id = m.company_id
    WHERE m.user_id = ?
    ORDER BY c.name COLLATE NOCASE, m.company_id
`;

export function listMemberships(userId: number): MembershipRow[] {
    return stmt(MEMBERSHIPS).all(userId) as MembershipRow[];
}

export function presentUser(
    user: { id: number; name: string; email: string; totp_enabled: number },
    companyId: number,
): AuthUser | undefined {
    const memberships = listMemberships(user.id);
    const active = memberships.find((row) => row.company_id === companyId);

    if (!active) {
        return undefined;
    }

    const summary: MembershipSummary[] = memberships.map((row) => ({
        company_id: row.company_id,
        company_name: row.company_name,
        role: row.role,
    }));

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        company_id: active.company_id,
        company_name: active.company_name,
        role: active.role,
        memberships: summary,
        totp_enabled: user.totp_enabled === 1,
        import_prompt:
            active.role === "dispatcher" &&
            active.vehicle_count === 0 &&
            active.import_prompt_dismissed_at === null,
    };
}

export function membershipRow(userId: number, companyId: number) {
    return listMemberships(userId).find((row) => row.company_id === companyId);
}
