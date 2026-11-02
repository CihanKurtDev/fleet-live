import { useEffect, useState } from "react";

import { getSim } from "../api/sim";

/**
 * How many times faster than the clock the demo simulation drives, or null
 * while unknown or when no simulation runs. Trips then show a „Zeitraffer“
 * tag, so a 169 km trip in 22 minutes does not read as a mistake.
 */
export function useSimTimeScale(): number | null {
    const [scale, setScale] = useState<number | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        getSim(controller.signal)
            .then((state) => setScale(state.available && state.time_scale > 1 ? state.time_scale : null))
            .catch(() => setScale(null));
        return () => controller.abort();
    }, []);

    return scale;
}
