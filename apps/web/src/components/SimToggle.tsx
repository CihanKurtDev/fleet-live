import { useEffect, useState } from "react";
import type { SimState } from "@fleet-live/shared";

import { getSim, setSimRunning } from "../api/sim";
import { Button } from "./ui/Button/Button";
import styles from "./SimToggle.module.scss";

export const SimToggle = () => {
    const [sim, setSim] = useState<SimState | null>(null);
    const [isBusy, setIsBusy] = useState(false);

    useEffect(() => {
        const controller = new AbortController();

        getSim(controller.signal)
            .then(setSim)
            .catch(() => setSim(null));

        return () => controller.abort();
    }, []);

    if (!sim?.available) {
        return null;
    }

    const toggle = async () => {
        setIsBusy(true);

        try {
            setSim(await setSimRunning(!sim.running));
        } catch {
            // Status bleibt, der nächste Klick versucht es erneut.
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <Button
            variant="secondary"
            size="sm"
            className={styles.toggle}
            disabled={isBusy}
            onClick={toggle}
            aria-pressed={sim.running}
        >
            {sim.running ? "Simulation pausieren" : "Simulation starten"}
        </Button>
    );
};
