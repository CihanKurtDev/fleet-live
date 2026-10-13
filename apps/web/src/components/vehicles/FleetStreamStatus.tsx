import { useEffect, useState } from "react";
import type { StreamConnection } from "../../context/vehiclesContext";
import { parseSqliteUtc } from "../../utils/dateTime";
import styles from "./FleetStreamStatus.module.scss";

type FleetStreamStatusProps = {
    connection: StreamConnection;
    lastTelemetryAt: string | null;
};

const ageSeconds = (value: string, now: number): number | null => {
    const date = parseSqliteUtc(value);

    if (!date) {
        return null;
    }

    return Math.max(0, Math.floor((now - date.getTime()) / 1000));
};

export const FleetStreamStatus = ({
    connection,
    lastTelemetryAt,
}: FleetStreamStatusProps) => {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (connection !== "live" || lastTelemetryAt === null) {
            return;
        }

        const timer = window.setInterval(() => {
            setNow(Date.now());
        }, 1000);

        return () => window.clearInterval(timer);
    }, [connection, lastTelemetryAt]);

    if (connection === "connecting") {
        return null;
    }

    if (connection === "disconnected") {
        return (
            <p className={styles.notice} role="status">
                Keine Live-Verbindung
            </p>
        );
    }

    const age =
        lastTelemetryAt === null ? null : ageSeconds(lastTelemetryAt, now);

    return (
        <p className={styles.live} role="status">
            Live
            {age !== null && (
                <span className={styles.age}>
                    letzte Änderung vor {age} s
                </span>
            )}
        </p>
    );
};
