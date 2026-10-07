import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
    scryptSync,
} from "node:crypto";
import { config } from "../config";

const key = scryptSync(config.totpEncryptionKey, "fleet-live-totp", 32);

export function seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
        cipher.update(plain, "utf8"),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
}

export function open(stored: string): string {
    const [ivHex, tagHex, dataHex] = stored.split(".");

    if (!ivHex || !tagHex || !dataHex) {
        throw new Error("Geheimnis ist beschädigt.");
    }

    const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));

    return Buffer.concat([
        decipher.update(Buffer.from(dataHex, "hex")),
        decipher.final(),
    ]).toString("utf8");
}
