import { addIsoDays, type VehicleDeadline } from "@fleet-live/shared";

// The rule lives in shared (the vehicle list filters with it on the server).
export { vehicleDeadlines, type VehicleDeadline } from "@fleet-live/shared";

/** Whole days from `today` to `dueOn` (negative when past). */
function daysUntil(dueOn: string, today: string): number {
    let days = 0;
    let cursor = today;

    if (dueOn >= today) {
        while (cursor < dueOn && days < 4000) {
            cursor = addIsoDays(cursor, 1);
            days += 1;
        }
        return days;
    }

    while (cursor > dueOn && days < 4000) {
        cursor = addIsoDays(cursor, -1);
        days += 1;
    }
    return -days;
}

/** „abgelaufen“, „heute fällig“, „in 12 Tagen“, „Datum fehlt“, or nothing when fine. */
export function deadlineStateText(deadline: VehicleDeadline, today: string): string {
    if (deadline.state === "missing") {
        return "Datum fehlt";
    }
    if (deadline.state === "overdue") {
        return "abgelaufen";
    }
    if (deadline.state === "soon" && deadline.due_on) {
        const days = daysUntil(deadline.due_on, today);
        return days === 0 ? "heute fällig" : days === 1 ? "morgen fällig" : `in ${days} Tagen`;
    }
    return "";
}

/** „seit 42 Tagen“, „seit 8 Monaten“: how long a date is past. */
export function expiredSinceText(dueOn: string, today: string): string {
    const days = -daysUntil(dueOn, today);
    if (days < 60) {
        return `seit ${days} ${days === 1 ? "Tag" : "Tagen"}`;
    }
    const months = Math.floor(days / 30.44);
    return `seit ${months} Monaten`;
}
