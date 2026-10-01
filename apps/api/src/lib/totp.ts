import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function randomTotpSecret(): Buffer {
    return randomBytes(20);
}

export function base32Encode(buffer: Buffer): string {
    let bits = 0;
    let value = 0;
    let output = "";

    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;

        while (bits >= 5) {
            output += ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    if (bits > 0) {
        output += ALPHABET[(value << (5 - bits)) & 31];
    }

    return output;
}

export function base32Decode(input: string): Buffer {
    const normalized = input.replace(/=+$/g, "").toUpperCase().replace(/\s/g, "");
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];

    for (const char of normalized) {
        const index = ALPHABET.indexOf(char);

        if (index === -1) {
            throw new Error("Geheimnis ist ungültig.");
        }

        value = (value << 5) | index;
        bits += 5;

        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }

    return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = createHmac("sha1", secret).update(buf).digest();
    const offset = hmac[hmac.length - 1]! & 0x0f;
    const binary =
        ((hmac[offset]! & 0x7f) << 24) |
        ((hmac[offset + 1]! & 0xff) << 16) |
        ((hmac[offset + 2]! & 0xff) << 8) |
        (hmac[offset + 3]! & 0xff);

    return (binary % 1_000_000).toString().padStart(DIGITS, "0");
}

export function totpCode(secret: Buffer, at = Date.now()): string {
    const counter = Math.floor(at / 1000 / STEP_SECONDS);
    return hotp(secret, counter);
}

export function verifyTotp(secret: Buffer, code: string, at = Date.now()): boolean {
    const normalized = code.replace(/\s/g, "");

    if (!/^\d{6}$/.test(normalized)) {
        return false;
    }

    const counter = Math.floor(at / 1000 / STEP_SECONDS);
    const given = Buffer.from(normalized);

    for (let drift = -1; drift <= 1; drift += 1) {
        const expected = Buffer.from(hotp(secret, counter + drift));

        if (expected.length === given.length && timingSafeEqual(expected, given)) {
            return true;
        }
    }

    return false;
}

export function otpauthUrl(email: string, secret: Buffer): string {
    const label = encodeURIComponent(`fleet-live:${email}`);
    const issuer = encodeURIComponent("fleet-live");

    return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

export function newRecoveryCode(): string {
    const raw = randomBytes(5).toString("hex");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}
