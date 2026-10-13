import { useEffect } from "react";
import {
    parseStreamConnected,
    parseTelemetryPatches,
    type TelemetryPatch,
} from "@fleet-live/shared";
import { getMe } from "../api/auth";
import { isAbortError } from "../api/client";
import { setStreamConnection } from "../api/telemetryFocus";
import { useLatestRef } from "./useLatestRef";

/** Drei verpasste Heartbeats (Server sendet alle 15 s). */
const STREAM_STALE_MS = 45_000;

interface UseVehicleStreamHandlers {
    onTelemetry: (patches: TelemetryPatch[]) => void;
    onVehiclesChanged: () => void;
    onConnection?: (state: "live" | "disconnected") => void;
}

export const useVehicleStream = (
    handlers: UseVehicleStreamHandlers,
) => {
    const handlersRef = useLatestRef(handlers);

    useEffect(() => {
        const source = new EventSource("/api/stream");
        let sessionProbe: AbortController | null = null;
        let staleTimer: number | undefined;

        const report = (state: "live" | "disconnected") => {
            handlersRef.current.onConnection?.(state);
        };
        const armStale = () => {
            if (staleTimer !== undefined) {
                window.clearTimeout(staleTimer);
            }

            staleTimer = window.setTimeout(() => {
                report("disconnected");
            }, STREAM_STALE_MS);
        };
        const markLive = () => {
            report("live");
            armStale();
        };

        source.onopen = () => {
            markLive();
        };

        source.addEventListener("heartbeat", () => {
            markLive();
        });

        source.addEventListener("connected", (event) => {
            markLive();

            try {
                const payload = parseStreamConnected(
                    JSON.parse((event as MessageEvent).data),
                );

                if (payload?.connection_id) {
                    setStreamConnection(payload.connection_id);
                }
            } catch {
                // Ungültige Events werden stillschweigend verworfen.
            }
        });

        source.addEventListener("telemetry", (event) => {
            try {
                const patches = parseTelemetryPatches(
                    JSON.parse((event as MessageEvent).data),
                );

                if (patches) {
                    markLive();
                    handlersRef.current.onTelemetry(patches);
                }
            } catch {
                // Ungültige Events werden stillschweigend verworfen.
            }
        });

        source.addEventListener("vehicles-changed", () => {
            markLive();
            handlersRef.current.onVehiclesChanged();
        });

        // EventSource liefert bei abgelaufener Session keinen Status — einmal /me prüfen.
        source.onerror = () => {
            report("disconnected");

            if (sessionProbe) {
                return;
            }

            sessionProbe = new AbortController();
            void getMe(sessionProbe.signal).catch((caught: unknown) => {
                if (isAbortError(caught)) {
                    return;
                }
                // 401 löst über request() → notifyUnauthorized den Login-Redirect aus.
            });
        };

        return () => {
            if (staleTimer !== undefined) {
                window.clearTimeout(staleTimer);
            }

            sessionProbe?.abort();
            setStreamConnection(null);
            source.close();
        };
    }, [handlersRef]);
};
