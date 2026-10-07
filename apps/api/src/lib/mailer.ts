import nodemailer from "nodemailer";
import { config } from "../config";
import { ServiceUnavailableError } from "./errors";
import { logger } from "../logger";

export type MailDelivery = "log" | "smtp";

export type CapturedMail = {
    to: string;
    subject: string;
    text: string;
    link: string;
};

const captured: CapturedMail[] = [];

export function takeMails(): CapturedMail[] {
    return captured.splice(0, captured.length);
}

export function assertMailConfigured() {
    if (config.isProduction && !config.smtpUrl) {
        throw new ServiceUnavailableError(
            "E-Mail ist nicht konfiguriert.",
            "MAIL_UNAVAILABLE",
        );
    }
}

export async function sendMail(input: {
    to: string;
    subject: string;
    text: string;
    link: string;
}): Promise<MailDelivery> {
    assertMailConfigured();

    if (config.isTest) {
        captured.push(input);
        return "log";
    }

    if (!config.smtpUrl) {
        logger.warn(
            { to: input.to, link: input.link },
            "Kein SMTP_URL — Link nicht per Mail, nur im Log",
        );
        return "log";
    }

    const transport = nodemailer.createTransport(config.smtpUrl);
    await transport.sendMail({
        from: config.mailFrom,
        to: input.to,
        subject: input.subject,
        text: `${input.text}\n\n${input.link}\n`,
    });

    return "smtp";
}

export function mailMessage(delivery: MailDelivery, pending: string): string {
    if (delivery === "log") {
        return `${pending} Ein Mailversand ist nicht eingerichtet — der Link steht im Server-Log, nicht im Posteingang.`;
    }

    return pending;
}
