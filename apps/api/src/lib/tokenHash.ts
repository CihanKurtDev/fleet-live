import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function newToken(): string {
    return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string, storedHash: string): boolean {
    const actual = Buffer.from(hashToken(token), "hex");
    const expected = Buffer.from(storedHash, "hex");

    if (actual.length !== expected.length || expected.length === 0) {
        return false;
    }

    return timingSafeEqual(actual, expected);
}
