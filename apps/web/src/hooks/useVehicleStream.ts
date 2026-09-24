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

interface UseVehicleStreamHandlers {
    onTelemetry: (patches: TelemetryPatch[]) => void;
    onVehiclesChanged: () => void;
}

export const useVehicleStream = (
    handlers: UseVehicleStreamHandlers,
) => {
    const handlersRef = useLatestRef(handlers);

    useEffect(() => {
        const source = new EventSource("/api/stream");
        let sessionProbe: AbortController | null = null;

        source.addEventListener("connected", (event) => {
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
                    handlersRef.current.onTelemetry(patches);
                }
            } catch {
                // Ungültige Events werden stillschweigend verworfen.
            }
        });

        source.addEventListener("vehicles-changed", () => {
            handlersRef.current.onVehiclesChanged();
        });

        // EventSource liefert bei abgelaufener Session keinen Status — einmal /me prüfen.
        source.onerror = () => {
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
            sessionProbe?.abort();
            setStreamConnection(null);
            source.close();
        };
    }, [handlersRef]);
};
