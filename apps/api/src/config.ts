import { join } from "node:path";
import { z } from "zod";

const environmentSchema = z.object({
    NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),

    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    /**
     * Dateipfad der SQLite-Datenbank.
     * ":memory:" wird von node:sqlite unterstützt und ist der Weg,
     * jeden Test gegen eine frische, isolierte Datenbank laufen zu lassen.
     */
    DATABASE_PATH: z
        .string()
        .min(1)
        .default(join(process.cwd(), "data", "fleetlive.db")),

    /** Kommaseparierte Liste oder "*" für alle Origins. */
    CORS_ORIGIN: z.string().min(1).default("*"),

    /** Intervall des Telemetrie-Simulators. 0 schaltet ihn ab. */
    TELEMETRY_TICK_MS: z.coerce.number().int().min(0).default(400),

    /**
     * Fahrzeuge pro Tick. Alle DRIVING-Zeilen auf einmal würde
     * bei 50k Datensätzen SQLite und den SSE-Stream blockieren.
     */
    TELEMETRY_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(32),

    LOG_LEVEL: z
        .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
        .default("info"),
});

const parsed = environmentSchema.safeParse(process.env);

if (!parsed.success) {
    const details = parsed.error.issues
        .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");

    // Fail-fast: ein falsch konfigurierter Prozess soll nicht erst
    // beim ersten Request auffallen.
    console.error(`Invalid environment configuration:\n${details}`);
    process.exit(1);
}

const env = parsed.data;

export const config = {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",
    port: env.PORT,
    databasePath: env.DATABASE_PATH,
    corsOrigin:
        env.CORS_ORIGIN === "*"
            ? "*"
            : env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    telemetryTickMs: env.TELEMETRY_TICK_MS,
    telemetryBatchSize: env.TELEMETRY_BATCH_SIZE,
    logLevel: env.LOG_LEVEL,
} as const;

export type Config = typeof config;
