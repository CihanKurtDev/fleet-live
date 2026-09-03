import { useEffect, useRef } from "react";
import {
    parseStreamConnected,
    parseTelemetryPatches,
    type TelemetryPatch,
} from "@fleet-live/shared";
import { setStreamConnection } from "../api/telemetryFocus";

interface UseVehicleStreamHandlers {
    onTelemetry: (patches: TelemetryPatch[]) => void;
    onVehiclesChanged: () => void;
}

export const useVehicleStream = (
    handlers: UseVehicleStreamHandlers,
) => {
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        const source = new EventSource("/api/stream");

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

        return () => {
            setStreamConnection(null);
            source.close();
        };
    }, []);
};
