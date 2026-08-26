import { createContext, useContext } from "react";
import type {
    Vehicle,
    VehicleFieldErrors,
    VehicleInput,
} from "@fleet-live/shared";

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
