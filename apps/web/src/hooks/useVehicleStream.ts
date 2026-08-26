import { useEffect, useRef } from "react";
import type { TelemetryPatch } from "@fleet-live/shared";

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

        source.addEventListener("telemetry", (event) => {
            try {
                const patches = JSON.parse(
                    (event as MessageEvent).data,
                ) as TelemetryPatch[];
                handlersRef.current.onTelemetry(patches);
            } catch {
                // Ungültige Events werden stillschweigend verworfen.
            }
        });

        source.addEventListener("vehicles-changed", () => {
            handlersRef.current.onVehiclesChanged();
        });

        return () => {
            source.close();
        };
    }, []);
};
