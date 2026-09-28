import { useEffect, useState } from "react";
import type { SimState } from "@fleet-live/shared";

import { getSim, setSimRunning } from "../api/sim";
import { Button } from "./ui/Button/Button";
import styles from "./SimToggle.module.scss";

export const SimToggle = () => {
    const [sim, setSim] = useState<SimState | null>(null);
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
        setError(null);

        try {
            setSim(await setSimRunning(!sim.running));
        } catch (caught: unknown) {
            setError(
                caught instanceof Error
                    ? caught.message
                    : "Simulation konnte nicht geändert werden.",
            );
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <div className={styles.wrap}>
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
            {error && (
                <span className={styles.error} role="alert">
                    {error}
                </span>
            )}
        </div>
    );
};
