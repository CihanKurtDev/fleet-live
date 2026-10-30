import { useEffect, useState } from "react";
import type { Damage } from "@fleet-live/shared";

import { listVehicleDamages } from "../api/damages";
import { useVehicles } from "../context/vehiclesContext";

/** The vehicle's damages, open ones first; reloaded with every vehicle change. */
export function useVehicleDamages(vehicleId: number | null) {
    const { listEpoch } = useVehicles();
    const [loaded, setLoaded] = useState<{ id: number; data: Damage[] } | null>(null);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        if (vehicleId === null) {
            return;
        }

        const controller = new AbortController();
        listVehicleDamages(vehicleId, controller.signal)
            .then((response) => setLoaded({ id: vehicleId, data: response.data }))
            .catch(() => {
                // The panel keeps what it showed; the next change loads again.
            });
        return () => controller.abort();
    }, [vehicleId, listEpoch, reload]);

    return {
        damages: loaded !== null && loaded.id === vehicleId ? loaded.data : [],
        reload: () => setReload((value) => value + 1),
    };
}
