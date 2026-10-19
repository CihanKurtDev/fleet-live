/**
 * Wrong second-factor codes per account, across every login step. A step
 * token is limited on its own as well; this limit holds when someone asks for
 * a fresh token after each try. Kept in memory like the other limiters.
 */
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

type Entry = { count: number; since: number };

const failures = new Map<number, Entry>();

function current(userId: number, now: number): Entry | undefined {
    const entry = failures.get(userId);

    if (entry && now - entry.since >= WINDOW_MS) {
        failures.delete(userId);
        return undefined;
    }

    return entry;
}

export function tooManyTotpFailures(userId: number, now = Date.now()): boolean {
    return (current(userId, now)?.count ?? 0) >= MAX_FAILURES;
}

export function recordTotpFailure(userId: number, now = Date.now()) {
    const entry = current(userId, now);

    if (entry) {
        entry.count += 1;
        return;
    }

    failures.set(userId, { count: 1, since: now });
}

export function clearTotpFailures(userId: number) {
    failures.delete(userId);
}

export function resetTotpAttemptsForTests() {
    failures.clear();
}
