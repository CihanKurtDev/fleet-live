import { useEffect, useState } from "react";
import { listAlerts } from "../api/alerts";
import { useVehicles } from "../context/vehiclesContext";

/** The number on „Warnungen“ in the header: one row asked for, the count comes with it. */
export const useOpenAlertCount = (): number | undefined => {
    const { listEpoch } = useVehicles();
    const [count, setCount] = useState<number | undefined>(undefined);

    useEffect(() => {
        const controller = new AbortController();

        listAlerts(
            { filter: "open", sort: "created_at", dir: "desc", page: 1, limit: 1, search: "" },
            controller.signal,
        )
            .then((response) => setCount(response.meta.counts.open))
            .catch(() => undefined);

        return () => controller.abort();
    }, [listEpoch]);

    return count;
};
