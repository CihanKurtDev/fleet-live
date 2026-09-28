import { app } from "./app";
import { config } from "./config";
import { closeDatabase } from "./db/database";
import { stmt } from "./db/statements";
import { logger } from "./logger";
import { closeAllSseClients } from "./sse/hub";
import {
    startTelemetryTicker,
    stopTelemetryTicker,
} from "./sse/telemetryTicker";

if (config.isProduction && !config.allowDemoAccounts) {
    const demoAccounts = stmt(
        `
        SELECT COUNT(*) AS total
        FROM users
        WHERE lower(email) IN ('cihan@example.com', 'viewer@example.com')
        `,
    ).get() as { total: number };

    if (Number(demoAccounts.total) > 0) {
        logger.fatal(
            "production start refused: demo accounts exist; remove them or set ALLOW_DEMO_ACCOUNTS=true intentionally",
        );
        closeDatabase();
        process.exit(1);
    }
}

const server = app.listen(config.port, () => {
    logger.info(`API running on http://localhost:${config.port}`);
});

if (config.telemetryTickMs > 0) {
    startTelemetryTicker(config.telemetryTickMs);
}

let shuttingDown = false;

function shutdown(signal: string) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    stopTelemetryTicker();
    closeAllSseClients();

    server.close(() => {
        closeDatabase();
        process.exit(0);
    });

    setTimeout(() => {
        logger.error("forced shutdown after timeout");
        process.exit(1);
    }, 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
