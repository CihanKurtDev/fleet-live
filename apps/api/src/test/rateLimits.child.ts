/**
 * Runs as a child process outside the test mode, where the sign-in limiters
 * are active. Prints one JSON line with the status codes it saw.
 */
import request from "supertest";
import { app } from "../app";

async function statuses(
    send: (index: number) => request.Test,
    count: number,
): Promise<number[]> {
    const seen: number[] = [];

    for (let index = 0; index < count; index += 1) {
        seen.push((await send(index)).status);
    }

    return seen;
}

async function main() {
    // A guessed second-factor step, each time from a "different" client that
    // only claims so in X-Forwarded-For.
    const totp = await statuses(
        (index) =>
            request(app)
                .post("/api/auth/totp")
                .set("X-Forwarded-For", `203.0.113.${index}`)
                .send({ challenge: `guess-${index}`, code: "123456" }),
        21,
    );
    const reset = await statuses(
        (index) =>
            request(app)
                .post("/api/auth/reset-password")
                .send({ token: `guess-${index}`, password: "a-new-password-1" }),
        21,
    );
    const invite = await statuses(
        (index) =>
            request(app)
                .post("/api/auth/invites/accept")
                .send({ token: `guess-${index}`, name: "X", password: "a-new-password-1" }),
        21,
    );

    const ssoStart = await statuses(() => request(app).get("/api/auth/sso/google/start"), 31);

    console.log(
        JSON.stringify({ totp, reset, invite, ssoStart, trustProxy: app.get("trust proxy") }),
    );
}

main().then(
    () => process.exit(0),
    (error: unknown) => {
        console.error(error);
        process.exit(1);
    },
);
