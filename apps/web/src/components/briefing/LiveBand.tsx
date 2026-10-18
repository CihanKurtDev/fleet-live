import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { Site } from "@fleet-live/shared";

import { listSites } from "../../api/sites";
import { useVehicles } from "../../context/vehiclesContext";
import { useFleetPositions } from "../../hooks/useFleetPositions";
import { formatCount } from "../../utils/formatCount";
import { LiveBandMap } from "./LiveBandMap";
import styles from "./LiveBand.module.scss";

const NO_DRIVERS: string[] = [];

/**
 * Top of Schicht: the real fleet map behind the title and the tiles. The
 * empty map area is one link to the fleet map; tiles and buttons on top keep
 * their own targets.
 */
export const LiveBand = ({
    labelledBy,
    children,
}: {
    labelledBy: string;
    children: ReactNode;
}) => {
    const { streamConnection } = useVehicles();
    const { vehicles, densityCells, mode } = useFleetPositions({
        drivers: NO_DRIVERS,
    });
    const [sites, setSites] = useState<Site[]>([]);

    useEffect(() => {
        const controller = new AbortController();

        // Depots only decorate the band; without them it still works.
        listSites(controller.signal)
            .then((response) => setSites(response.data))
            .catch(() => undefined);

        return () => controller.abort();
    }, []);

    const placed =
        mode === "positions"
            ? vehicles.filter((vehicle) => vehicle.has_position).length
            : densityCells.reduce((sum, cell) => sum + cell.total, 0);
    const live = streamConnection === "live";

    return (
        <section className={styles.band} aria-labelledby={labelledBy}>
            <LiveBandMap
                className={styles.canvas}
                vehicles={vehicles}
                densityCells={densityCells}
                sites={sites}
            />
            <div className={styles.shade} aria-hidden="true" />
            {/* A click on the map opens it; keyboard and screen readers use
                the "Karte öffnen" button in the title row. */}
            <Link
                to="/fleet"
                viewTransition
                className={styles.mapLink}
                tabIndex={-1}
                aria-hidden="true"
            />
            <div className={styles.content}>
                <p className={styles.live}>
                    {live && <span className={styles.liveDot} aria-hidden="true" />}
                    {live ? "Live · " : ""}
                    {formatCount(placed)}{" "}
                    {placed === 1 ? "Fahrzeug" : "Fahrzeuge"} mit Position
                </p>
                {children}
            </div>
        </section>
    );
};
