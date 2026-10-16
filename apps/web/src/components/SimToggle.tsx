import { useEffect, useState } from "react";
import type { SimState } from "@fleet-live/shared";

import { getSim, setSimRunning } from "../api/sim";
import { Button } from "./ui/Button/Button";
import { SwapLabel } from "./ui/Button/SwapLabel";
import styles from "./SimToggle.module.scss";

export const SimToggle = ({ fullWidth = false }: { fullWidth?: boolean }) => {
    // undefined: still loading; null: not available for this session.
    const [sim, setSim] = useState<SimState | null | undefined>(undefined);
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();

        getSim(controller.signal)
            .then(setSim)
            .catch(() => {
                if (!controller.signal.aborted) {
                    setSim(null);
                }
            });

        return () => controller.abort();
    }, []);

    if (sim === undefined) {
        // Holds the button's place while loading, so the header does not shift.
        return (
            <div className={styles.wrap} aria-hidden="true">
                <Button
                    variant="secondary"
                    size={fullWidth ? "md" : "sm"}
                    className={`${styles.toggle} ${styles.placeholder}`}
                    fullWidth={fullWidth}
                    disabled
                    tabIndex={-1}
                >
                    Simulation pausieren
                </Button>
            </div>
        );
    }

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
        <div
            className={
                fullWidth ? `${styles.wrap} ${styles.fullWidth}` : styles.wrap
            }
        >
            <Button
                variant="secondary"
                size={fullWidth ? "md" : "sm"}
                className={styles.toggle}
                fullWidth={fullWidth}
                disabled={isBusy}
                onClick={toggle}
                aria-pressed={sim.running}
                title={
                    sim.running
                        ? "Pausiert die Simulation dieser Firma. Positionen bleiben stehen. Nach etwa 15 Sekunden ohne Meldung entsteht eine Warnung für Fahrzeuge, die gerade liefen."
                        : "Startet die Simulation dieser Firma wieder."
                }
            >
                <SwapLabel swapped={!sim.running} alt="Simulation starten">
                    Simulation pausieren
                </SwapLabel>
            </Button>
            {error && (
                <span className={styles.error} role="alert">
                    {error}
                </span>
            )}
        </div>
    );
};
