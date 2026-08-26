import {
    useCallback,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import type {
    VehicleFieldErrors,
    VehicleInput,
} from "@fleet-live/shared";
import { mockVehicles } from "../mocks/vehicles";
import { VehiclesContext } from "./vehiclesContext";

/**
 * Hält die Fahrzeugliste.
 *
 * Aktuell aus Mock-Daten. Bei der API-Integration wird nur der Inhalt
 * dieses Providers ersetzt, die Schnittstelle für die Seiten bleibt gleich.
 */
export const VehiclesProvider = ({
    children,
}: {
    children: ReactNode;
}) => {
    const [vehicles, setVehicles] = useState(mockVehicles);

    const getVehicle = useCallback(
        (id: number) =>
            vehicles.find((vehicle) => vehicle.id === id),
        [vehicles],
    );

    /** Die API antwortet auf ein doppeltes Kennzeichen mit 409. */
    const findPlateConflict = useCallback(
        (licensePlate: string, exceptId?: number) =>
            vehicles.some(
                (vehicle) =>
                    vehicle.id !== exceptId &&
                    vehicle.license_plate.toLowerCase() ===
                        licensePlate.trim().toLowerCase(),
            ),
        [vehicles],
    );

    const createVehicle = useCallback(
        (input: VehicleInput): VehicleFieldErrors | void => {
            if (findPlateConflict(input.license_plate)) {
                return {
                    license_plate:
                        "Kennzeichen ist bereits vergeben.",
                };
            }

            setVehicles((current) => [
                {
                    ...input,
                    license_plate: input.license_plate.trim(),
                    driver_name: input.driver_name.trim(),
                    id:
                        current.reduce(
                            (max, vehicle) =>
                                Math.max(max, vehicle.id),
                            0,
                        ) + 1,
                    latitude: null,
                    longitude: null,
                    speed: null,
                    recorded_at: null,
                    activeAlerts: 0,
                },
                ...current,
            ]);
        },
        [findPlateConflict],
    );

    const updateVehicle = useCallback(
        (
            id: number,
            input: VehicleInput,
        ): VehicleFieldErrors | void => {
            if (findPlateConflict(input.license_plate, id)) {
                return {
                    license_plate:
                        "Kennzeichen ist bereits vergeben.",
                };
            }

            setVehicles((current) =>
                current.map((vehicle) =>
                    vehicle.id === id
                        ? {
                              ...vehicle,
                              ...input,
                              license_plate:
                                  input.license_plate.trim(),
                              driver_name:
                                  input.driver_name.trim(),
                          }
                        : vehicle,
                ),
            );
        },
        [findPlateConflict],
    );

    const deleteVehicles = useCallback((ids: number[]) => {
        setVehicles((current) =>
            current.filter(
                (vehicle) => !ids.includes(vehicle.id),
            ),
        );
    }, []);

    const value = useMemo(
        () => ({
            vehicles,
            getVehicle,
            createVehicle,
            updateVehicle,
            deleteVehicles,
        }),
        [
            vehicles,
            getVehicle,
            createVehicle,
            updateVehicle,
            deleteVehicles,
        ],
    );

    return (
        <VehiclesContext.Provider value={value}>
            {children}
        </VehiclesContext.Provider>
    );
};
