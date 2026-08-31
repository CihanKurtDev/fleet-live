import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "../config";

const KEY_LENGTH = 32;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

const scryptCost = () => (config.isTest ? 1024 : 16_384);

const toKey = (password: string, salt: Buffer, cost: number) =>
    scryptSync(password, salt, KEY_LENGTH, {
        N: cost,
        r: SCRYPT_R,
        p: SCRYPT_P,
    });

export function hashPassword(password: string): string {
    const cost = scryptCost();
    const salt = randomBytes(16);
    const key = toKey(password, salt, cost);

    return `scrypt$${cost}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
    if (!stored.startsWith("scrypt$")) {
        const left = Buffer.from(password);
        const right = Buffer.from(stored);

        if (left.length !== right.length) {
            return false;
        }

        return timingSafeEqual(left, right);
    }

    const parts = stored.split("$");

    if (parts.length !== 6) {
        return false;
    }

    const cost = Number(parts[1]);
    const salt = Buffer.from(parts[4], "hex");
    const expected = Buffer.from(parts[5], "hex");

    if (!Number.isInteger(cost) || salt.length === 0 || expected.length === 0) {
        return false;
    }

    const actual = toKey(password, salt, cost);

    if (actual.length !== expected.length) {
        return false;
    }

    return timingSafeEqual(actual, expected);
}

export function needsRehash(stored: string): boolean {
    return !stored.startsWith("scrypt$");
}
