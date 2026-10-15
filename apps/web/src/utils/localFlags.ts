/**
 * Small per-browser flags (hidden panels, seen tips). Storage can be missing
 * or blocked (private windows, previews), so every access is guarded and a
 * failed read counts as "not set".
 */
export function readFlag(key: string): boolean {
    try {
        return window.localStorage.getItem(key) === "1";
    } catch {
        return false;
    }
}

export function writeFlag(key: string, value = true): void {
    try {
        if (value) {
            window.localStorage.setItem(key, "1");
        } else {
            window.localStorage.removeItem(key);
        }
    } catch {
        // Without storage the flag only lasts for this page view.
    }
}

/** Key for one person in one company. */
export const userCompanyKey = (
    name: string,
    user: { id: number; company_id: number },
) => `fleet-live:${name}:${user.id}:${user.company_id}`;

/** Key for one person, across companies. */
export const userKey = (name: string, user: { id: number }) =>
    `fleet-live:${name}:${user.id}`;
