import { createContext, useContext } from "react";
import type {
    Vehicle,
    VehicleFieldErrors,
    VehicleInput,
} from "@fleet-live/shared";

export interface VehiclesContextValue {
    vehicles: Vehicle[];
    getVehicle: (id: number) => Vehicle | undefined;

    /** Gibt Feldfehler zurück, wenn das Anlegen abgelehnt wird. */
    createVehicle: (
        input: VehicleInput,
    ) => VehicleFieldErrors | void;

    updateVehicle: (
        id: number,
        input: VehicleInput,
    ) => VehicleFieldErrors | void;

    deleteVehicles: (ids: number[]) => void;
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
