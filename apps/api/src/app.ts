import compression from "compression";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { config } from "./config";
import { logger } from "./logger";
import { requestId } from "./middleware/requestId";
import { attachSession } from "./middleware/attachSession";
import { requireAuth } from "./middleware/requireAuth";
import { requireDispatcher } from "./middleware/requireDispatcher";
import { errorHandler } from "./middleware/errorHandler";
import { notFound } from "./middleware/notFound";
import vehicleRoutes from "./routes/vehicle.routes";
import alertRoutes from "./routes/alert.routes";
import driverRoutes from "./routes/driver.routes";
import briefingRoutes from "./routes/briefing.routes";
import dueRoutes from "./routes/due.routes";
import todayRoutes from "./routes/today.routes";
import authRoutes from "./routes/auth.routes";
import importRoutes from "./routes/import.routes";
import exportRoutes from "./routes/export.routes";
import siteRoutes from "./routes/site.routes";
import workshopRoutes from "./routes/workshop.routes";
import damageRoutes from "./routes/damage.routes";
import { setStreamFocus, streamEvents } from "./controllers/stream.controller";
import {
    getSim,
    getSimRoutes,
    updateSim,
} from "./controllers/sim.controller";

export function createApp() {
    const app = express();

    app.disable("x-powered-by");
    // 0: X-Forwarded-For is ignored and the socket address counts (limiters,
    // logs). Behind a proxy that overwrites the header, set TRUST_PROXY_HOPS.
    app.set("trust proxy", config.trustProxyHops);

    app.use(requestId);
    app.use(
        pinoHttp({
            logger,
            genReqId: (req) => (req as { id?: string }).id ?? "unknown",
            autoLogging: !config.isTest,
        }),
    );
    app.use(helmet());
    app.use(
        cors({
            origin: config.corsOrigin,
            credentials: config.corsOrigin !== "*",
        }),
    );
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
    app.use((req, res, next) => {
        // Import files are read after the sign-in and role checks
        // (routes/import.routes.ts), not for anyone who sends a body.
        if (req.path.startsWith("/api/import")) {
            next();
            return;
        }

        // Die Fokus-Liste trägt bis zu STREAM_FOCUS_MAX_IDS Zahlen (~6 Byte je ID).
        const limit = req.path === "/api/stream/focus" ? "64kb" : "16kb";
        express.json({ limit })(req, res, next);
    });
    app.use((req, res, next) => {
        if (
            !config.isProduction ||
            ["GET", "HEAD", "OPTIONS"].includes(req.method)
        ) {
            next();
            return;
        }

        const origin = req.get("Origin");
        const allowedOrigins =
            config.corsOrigin === "*" ? [] : config.corsOrigin;

        if (!origin || !allowedOrigins.includes(origin)) {
            res.status(403).json({
                error: "Anfrage stammt nicht von einer erlaubten Origin.",
                code: "ORIGIN_FORBIDDEN",
            });
            return;
        }

        next();
    });
    app.use(attachSession);
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

    app.get("/api/sim", requireAuth, getSim);
    app.get("/api/sim/routes", requireAuth, getSimRoutes);
    app.patch("/api/sim", requireAuth, requireDispatcher, updateSim);
    app.get("/api/stream", requireAuth, streamEvents);
    app.post("/api/stream/focus", requireAuth, setStreamFocus);
    app.use("/api/auth", authRoutes);
    app.use("/api/briefing", requireAuth, briefingRoutes);
    app.use("/api/due", requireAuth, dueRoutes);
    app.use("/api/today", requireAuth, todayRoutes);
    app.use("/api/vehicles", requireAuth, vehicleRoutes);
    app.use("/api/alerts", requireAuth, alertRoutes);
    app.use("/api/drivers", requireAuth, driverRoutes);
    app.use("/api/import", requireAuth, importRoutes);
    app.use("/api/export", requireAuth, exportRoutes);
    app.use("/api/sites", requireAuth, siteRoutes);
    app.use("/api/workshop", requireAuth, workshopRoutes);
    app.use("/api/damages", requireAuth, damageRoutes);

    app.use(notFound);
    app.use(errorHandler);

    return app;
}

export const app = createApp();
