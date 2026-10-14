/** Label of the "soon" state for the company lead time. */
export function dueSoonLabel(leadDays: number): string {
    return leadDays === 0 ? "Heute" : `In ${leadDays} Tagen`;
}
