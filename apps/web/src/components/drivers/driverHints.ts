import {
    DUE_KIND_LABELS,
    berlinTodayIso,
    classifyDueOn,
    classifyLicenceInterval,
    dueRule,
    type DriverDetail,
} from "@fleet-live/shared";

import { formatIsoDate } from "../../utils/dateTime";

export type DriverFormField = "phone" | "licence-expires" | "licence-checked";

type Hint = {
    key: string;
    /** The edit-form field the hint asks for. */
    field: DriverFormField;
    tag: string;
    tone?: "warning";
    text: string;
    /** `/fristen` link for viewers; dispatchers get "Eintragen". */
    fristen?: { state: "overdue" | "missing"; kind: string };
};

/** What needs an entry now: missing or past. "Soon" stays on /fristen. */
export function driverHints(driver: DriverDetail, checkMonths: number): Hint[] {
    const today = berlinTodayIso();
    const hints: Hint[] = [];
    const expiryState = classifyDueOn(driver.licence_expires_on, today, 0);

    if (expiryState === "missing") {
        hints.push({
            key: "licence_expiry",
            field: "licence-expires",
            tag: "Frist",
            text: `${DUE_KIND_LABELS.licence_expiry}-Ablaufdatum fehlt`,
            fristen: { state: "missing", kind: "licence_expiry" },
        });
    } else if (expiryState === "overdue") {
        hints.push({
            key: "licence_expiry",
            field: "licence-expires",
            tag: "Frist",
            text: `${DUE_KIND_LABELS.licence_expiry} ist am ${formatIsoDate(driver.licence_expires_on)} abgelaufen`,
            fristen: { state: "overdue", kind: "licence_expiry" },
        });
    }

    const check = classifyLicenceInterval({
        checkedOn: driver.licence_checked_on,
        today,
        intervalMonths: checkMonths,
        leadDays: 0,
    });

    if (check.included && check.state === "overdue") {
        hints.push({
            key: "licence_check",
            field: "licence-checked",
            tag: "Kontrolle",
            tone: "warning",
            text:
                check.due_on === null
                    ? "Führerscheinkontrolle noch nie eingetragen"
                    : `Führerscheinkontrolle war am ${formatIsoDate(check.due_on)} fällig`,
            fristen: { state: "overdue", kind: "licence_check" },
        });
    }

    if (!driver.phone) {
        hints.push({
            key: "phone",
            field: "phone",
            tag: "Kontakt",
            text: "Telefon fehlt",
        });
    }

    return hints;
}

/** The interval the company uses for licence checks; the rule default otherwise. */
export const defaultCheckMonths = () =>
    dueRule("licence_check").interval_months ?? 6;
