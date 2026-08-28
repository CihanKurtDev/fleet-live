import { createContext, useContext } from "react";
import type {
    Vehicle,
    VehicleFieldErrors,
    VehicleInput,
} from "@fleet-live/shared";

export type TripPathDeltaHandler = (
    vehicleId: number,
    delta: string,
    reset: boolean,
) => void;

export interface VehiclesContextValue {
    listEpoch: number;
    vehicleOverrides: Record<number, Partial<Vehicle>>;
    refetchLists: () => void;

    createVehicle: (
        input: VehicleInput,
    ) => Promise<VehicleFieldErrors | void>;

    updateVehicle: (
        id: number,
        input: VehicleInput,
    ) => Promise<VehicleFieldErrors | void>;

    deleteVehicles: (ids: number[]) => Promise<void>;

    /**
     * Live-Suffix der Fahrtlinie. Kein Replay: nur Ticks nach dem Subscribe.
     * Die Detailseite hängt das an den geladenen `Trip.path`, außer der
     * Tick eine neue Fahrt beginnt (`reset`).
     */
    subscribeTripPath: (handler: TripPathDeltaHandler) => () => void;
}

export const VehiclesContext =
    createContext<VehiclesContextValue | null>(null);

export const useVehicles = () => {
    const context = useContext(VehiclesContext);

    if (!context) {
        throw new Error(
            "useVehicles muss innerhalb von VehiclesProvider verwendet werden.",
        );
    }

    return context;
};
