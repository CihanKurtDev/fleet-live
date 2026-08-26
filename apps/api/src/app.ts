import compression from "compression";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { config } from "./config";
import { logger } from "./logger";
import { errorHandler } from "./middleware/errorHandler";
import { notFound } from "./middleware/notFound";
import { requestId } from "./middleware/requestId";
import vehicleRoutes from "./routes/vehicle.routes";
import { setStreamFocus, streamEvents } from "./controllers/stream.controller";

declare global {
    namespace Express {
        interface Request {
            id: string;
        }
    }
}

export function createApp() {
    const app = express();

    app.disable("x-powered-by");

    app.use(requestId);
    app.use(
        pinoHttp({
            logger,
            genReqId: (req) => (req as { id?: string }).id ?? "unknown",
            autoLogging: !config.isTest,
        }),
    );
    app.use(helmet());
    app.use(cors({ origin: config.corsOrigin }));
    app.use(
        compression({
            filter: (req, res) => {
                if (req.path === "/api/stream") {
                    return false;
                }

                const contentType = res.getHeader("Content-Type");
                if (
                    typeof contentType === "string" &&
                    contentType.includes("text/event-stream")
                ) {
                    return false;
                }

                return compression.filter(req, res);
            },
        }),
    );
    app.use(express.json({ limit: "16kb" }));
    app.use(
        "/api",
        rateLimit({
            windowMs: 60_000,
            limit: 300,
            standardHeaders: "draft-8",
            legacyHeaders: false,
            skip: () => config.isTest || !config.isProduction,
        }),
    );

    app.get("/api/health", (_req, res) => {
        res.json({ status: "ok" });
    });

    app.get("/api/stream", streamEvents);
    app.post("/api/stream/focus", setStreamFocus);
    app.use("/api/vehicles", vehicleRoutes);

    app.use(notFound);
    app.use(errorHandler);

    return app;
}

export const app = createApp();
