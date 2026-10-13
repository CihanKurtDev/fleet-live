import { companyDueSettingsSchema } from "@fleet-live/shared";
import { stmt } from "../db/statements";
import { NotFoundError } from "../lib/errors";

export type CompanyDueSettings = {
    due_lead_days: number | null;
    licence_check_months: number | null;
};

export class CompanyModel {
    static dueSettings(companyId: number): CompanyDueSettings | undefined {
        const row = stmt(
            `
            SELECT due_lead_days, licence_check_months
            FROM companies
            WHERE id = ?
            `,
        ).get(companyId) as CompanyDueSettings | undefined;

        return row === undefined ? undefined : { ...row };
    }

    static updateDueSettings(
        companyId: number,
        input: unknown,
    ): CompanyDueSettings {
        const current = this.dueSettings(companyId);

        if (!current) {
            throw new NotFoundError("Firma nicht gefunden.");
        }

        const parsed = companyDueSettingsSchema.parse(input);
        const dueLeadDays =
            parsed.due_lead_days === undefined
                ? current.due_lead_days
                : parsed.due_lead_days;
        const licenceCheckMonths =
            parsed.licence_check_months === undefined
                ? current.licence_check_months
                : parsed.licence_check_months;

        stmt(
            `
            UPDATE companies
            SET due_lead_days = ?, licence_check_months = ?
            WHERE id = ?
            `,
        ).run(dueLeadDays, licenceCheckMonths, companyId);

        return {
            due_lead_days: dueLeadDays,
            licence_check_months: licenceCheckMonths,
        };
    }
}
