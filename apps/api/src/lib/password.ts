import {
    randomBytes,
    scrypt,
    scryptSync,
    timingSafeEqual,
    type ScryptOptions,
} from "node:crypto";
import { config } from "../config";

const KEY_LENGTH = 32;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/**
 * Work factor of a new hash (N = 2^16, 64 MiB). The stored value keeps its own
 * factor, so older hashes still verify and are replaced at the next sign-in.
 */
const scryptCost = () => (config.isTest ? 1024 : 65_536);

/** scrypt needs about 128 * N * r bytes; the default limit is 32 MiB. */
const options = (cost: number): ScryptOptions => ({
    N: cost,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 256 * cost * SCRYPT_R,
});

const toKey = (password: string, salt: Buffer, cost: number) =>
    scryptSync(password, salt, KEY_LENGTH, options(cost));

/** The same key without holding the only thread: scrypt runs in the thread pool. */
const toKeyAsync = (password: string, salt: Buffer, cost: number) =>
    new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, KEY_LENGTH, options(cost), (error, key) =>
            error ? reject(error) : resolve(key),
        );
    });

const format = (cost: number, salt: Buffer, key: Buffer) =>
    `scrypt$${cost}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${key.toString("hex")}`;

export function hashPassword(password: string, cost = scryptCost()): string {
    const salt = randomBytes(16);

    return format(cost, salt, toKey(password, salt, cost));
}

export async function hashPasswordAsync(password: string): Promise<string> {
    const cost = scryptCost();
    const salt = randomBytes(16);

    return format(cost, salt, await toKeyAsync(password, salt, cost));
}

type Stored = { cost: number; salt: Buffer; expected: Buffer };

function parseStored(stored: string): Stored | undefined {
    const parts = stored.split("$");

    if (parts.length !== 6) {
        return undefined;
    }

    const cost = Number(parts[1]);
    const salt = Buffer.from(parts[4], "hex");
    const expected = Buffer.from(parts[5], "hex");

    if (!Number.isInteger(cost) || salt.length === 0 || expected.length === 0) {
        return undefined;
    }

    return { cost, salt, expected };
}

/** A value from before hashing: compared as it is. */
function matchesLegacy(password: string, stored: string): boolean {
    const left = Buffer.from(password);
    const right = Buffer.from(stored);

    return left.length === right.length && timingSafeEqual(left, right);
}

function sameKey(actual: Buffer, expected: Buffer): boolean {
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifyPassword(password: string, stored: string): boolean {
    if (!stored.startsWith("scrypt$")) {
        return matchesLegacy(password, stored);
    }

    const parsed = parseStored(stored);

    return parsed
        ? sameKey(toKey(password, parsed.salt, parsed.cost), parsed.expected)
        : false;
}

export async function verifyPasswordAsync(
    password: string,
    stored: string,
): Promise<boolean> {
    if (!stored.startsWith("scrypt$")) {
        return matchesLegacy(password, stored);
    }

    const parsed = parseStored(stored);

    return parsed
        ? sameKey(
              await toKeyAsync(password, parsed.salt, parsed.cost),
              parsed.expected,
          )
        : false;
}

/** Not hashed at all, or hashed with less work than a new hash gets. */
export function needsRehash(stored: string): boolean {
    if (!stored.startsWith("scrypt$")) {
        return true;
    }

    const parsed = parseStored(stored);

    return !parsed || parsed.cost < scryptCost();
}

let decoy: Promise<string> | undefined;

/**
 * Takes the time of a real check. A sign-in for an email that has no password
 * calls it, so the answer does not come measurably faster than for a wrong
 * password of a known account.
 */
export async function spendPasswordTime(password: string): Promise<void> {
    decoy ??= hashPasswordAsync("decoy-password");
    await verifyPasswordAsync(password, await decoy);
}
