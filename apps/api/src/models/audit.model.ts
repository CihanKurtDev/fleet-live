import {
    AUDIT_PAGE_LIMIT,
    type AuditAction,
    type AuditDetails,
    type AuditEvent,
} from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { pagedQuery } from "../lib/pagination";
import { UserModel } from "./user.model";

type AuditRow = Omit<AuditEvent, "details"> & { details: string | null; total?: number };

export const AuditModel = {
    /** Writes one entry; names come from the accounts as they are now. */
    record(input: {
        companyId: number;
        action: AuditAction;
        actorId: number | null;
        targetId?: number | null;
        details?: AuditDetails;
    }) {
        const actor = input.actorId === null ? undefined : UserModel.getById(input.actorId);
        const target =
            input.targetId === undefined || input.targetId === null
                ? undefined
                : UserModel.getById(input.targetId);

        stmt(
            `
            INSERT INTO audit_events (
                company_id, action, actor_user_id, actor_name,
                target_user_id, target_name, target_email, details
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
        ).run(
            input.companyId,
            input.action,
            actor?.id ?? null,
            actor?.name ?? null,
            target?.id ?? null,
            target?.name ?? null,
            target?.email ?? null,
            input.details ? JSON.stringify(input.details) : null,
        );
    },

    /** Newest first, one page of the company's log. */
    list(companyId: number, page: number) {
        return pagedQuery<AuditRow, AuditEvent>({
            listSql: `
                SELECT id, created_at, action, actor_name, target_name,
                       target_email, details, COUNT(*) OVER () AS total
                FROM audit_events
                WHERE company_id = ?
                ORDER BY id DESC
                LIMIT ? OFFSET ?
            `,
            listParams: [companyId, AUDIT_PAGE_LIMIT, (page - 1) * AUDIT_PAGE_LIMIT],
            countSql: "SELECT COUNT(*) AS total FROM audit_events WHERE company_id = ?",
            countParams: [companyId],
            page,
            limit: AUDIT_PAGE_LIMIT,
            map: ({ total: _total, details, ...row }) => ({
                ...row,
                details: details ? (JSON.parse(details) as AuditDetails) : null,
            }),
        });
    },
};
