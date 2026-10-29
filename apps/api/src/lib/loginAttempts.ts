/**
 * Wrong passwords per e-mail address. A fixed lock (8 tries, then 15 minutes)
 * locked the real person out as well. Now the first few wrong tries cost
 * nothing, and every further one makes the next try wait longer: 2, 4, 8 …
 * seconds, at most a minute. The right password works as soon as the wait is
 * over, and a guesser gets about one try a minute. Kept per address, not per
 * account, so an address without an account answers the same. In memory like
 * the other limiters.
 */
const FREE_FAILURES = 5;
const MAX_WAIT_MS = 60 * 1000;
const FORGET_AFTER_MS = 15 * 60 * 1000;

type Entry = { failures: number; lastFailure: number; nextTry: number };

const entries = new Map<string, Entry>();
let clock = () => Date.now();

const keyOf = (email: string) => email.trim().toLowerCase();

function current(key: string, now: number): Entry | undefined {
    const entry = entries.get(key);

    if (entry && now - entry.lastFailure >= FORGET_AFTER_MS) {
        entries.delete(key);
        return undefined;
    }

    return entry;
}

/** Whole seconds until this address may try again; 0 when it may now. */
export function loginWaitSeconds(email: string): number {
    const now = clock();
    const entry = current(keyOf(email), now);

    return entry && entry.nextTry > now ? Math.ceil((entry.nextTry - now) / 1000) : 0;
}

export function recordLoginFailure(email: string) {
    const now = clock();
    const key = keyOf(email);
    const entry = current(key, now) ?? { failures: 0, lastFailure: now, nextTry: now };
    const over = entry.failures + 1 - FREE_FAILURES;

    entries.set(key, {
        failures: entry.failures + 1,
        lastFailure: now,
        nextTry: over > 0 ? now + Math.min(MAX_WAIT_MS, 1000 * 2 ** over) : now,
    });
}

export function clearLoginFailures(email: string) {
    entries.delete(keyOf(email));
}

export function resetLoginAttemptsForTests() {
    entries.clear();
    clock = () => Date.now();
}

export function setLoginClockForTests(next: () => number) {
    clock = next;
}
