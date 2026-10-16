import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { FleetPosition } from "@fleet-live/shared";

import {
    formatRelativeTimestamp,
    formatTimestamp,
} from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import { vehicleStatusLabel } from "./vehicleStatus";
import styles from "./FleetDetailPanel.module.scss";

type FleetDetailPanelProps = {
    vehicle: FleetPosition;
    from: string;
    onClose: () => void;
};

export const FleetDetailPanel = ({
    vehicle,
    from,
    onClose,
}: FleetDetailPanelProps) => {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setTick((current) => current + 1);
        }, 1000);

        return () => window.clearInterval(timer);
    }, []);

    const reported = useMemo(
        () =>
            vehicle.recorded_at === null
                ? "Noch keine Meldung"
                : `Zuletzt gemeldet ${formatRelativeTimestamp(vehicle.recorded_at)}`,
        [tick, vehicle.recorded_at],
    );

    return (
        <div className={styles.panel}>
            <div className={styles.head}>
                <h2 className={styles.plate}>{vehicle.license_plate}</h2>
                <Button variant="ghost" size="sm" onClick={onClose}>
                    Schließen
                </Button>
            </div>
            <dl className={styles.facts}>
                <div>
                    <dt>Fahrer</dt>
                    <dd>{vehicle.driver_name ?? "Kein Fahrer"}</dd>
                </div>
                <div>
                    <dt>Status</dt>
                    <dd>{vehicleStatusLabel(vehicle.status)}</dd>
                </div>
                <div>
                    <dt>Tempo</dt>
                    <dd>
                        {vehicle.speed === null
                            ? "—"
                            : `${vehicle.speed} km/h`}
                    </dd>
                </div>
                <div>
                    <dt>Meldung</dt>
                    <dd title={formatTimestamp(vehicle.recorded_at)}>
                        {reported}
                    </dd>
                </div>
            </dl>
            <Link
                className={styles.more}
                to={`/vehicles/${vehicle.id}`}
                state={{ from }}
            >
                Fahrzeugseite
            </Link>
        </div>
    );
};
