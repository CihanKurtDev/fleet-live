import pino from "pino";
import { config } from "./config";

export const logger = pino({
    level: config.logLevel,
    redact: {
        paths: [
            "req.headers.cookie",
            "req.headers.authorization",
            'res.headers["set-cookie"]',
        ],
        censor: "[Redacted]",
    },
    ...(config.nodeEnv === "development"
        ? {
              transport: {
                  target: "pino-pretty",
                  options: { colorize: true, translateTime: "HH:MM:ss" },
              },
          }
        : {}),
});
