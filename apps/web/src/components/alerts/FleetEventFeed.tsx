import { Link } from "react-router";
import type { Alert, AlertType, AlertTypeCounts } from "@fleet-live/shared";

import { formatEventTime, formatTimestamp } from "../../utils/dateTime";
import { formatCount } from "../../utils/formatCount";
import { RetryMessage } from "../ui/RetryMessage";
import { ALERT_TYPE_CHIPS } from "./alertLabels";
import {
    fleetEventDetail,
    isRunningEvent,
    visibleEventTypes,
} from "./fleetEvents";
import styles from "./FleetEventFeed.module.scss";

const TYPE_CLASS: Record<AlertType, string> = {
    SPEEDING: styles.typeSpeeding,
    OFFLINE: styles.typeOffline,
    LOW_FUEL: styles.typeFuel,
};

type FleetEventFeedProps = {
    alerts: Alert[];
    typeCounts?: AlertTypeCounts;
    activeType: AlertType | null;
    selectedVehicleId: number | null;
    isLoading: boolean;
    error: string | null;
    inboxHref: string;
    onTypeChange: (type: AlertType | null) => void;
    onPick: (alert: Alert) => void;
    onRetry: () => void;
};

/** Neueste Warnungen der Firma, offen und erledigt. */
export const FleetEventFeed = ({
    alerts,
    typeCounts,
    activeType,
    selectedVehicleId,
    isLoading,
    error,
    inboxHref,
    onTypeChange,
    onPick,
    onRetry,
}: FleetEventFeedProps) => {
    const types = visibleEventTypes(typeCounts, activeType);

    return (
        <section className={styles.feed} aria-labelledby="fleet-events-title">
            <div className={styles.head}>
                <h2 id="fleet-events-title" className={styles.title}>
                    Live-Ereignisse
                </h2>
                {typeCounts && (
                    <span className={styles.total}>
                        {formatCount(typeCounts.all)} gesamt
                    </span>
                )}
            </div>
            {types.length > 0 && (
                <div
                    className={styles.chips}
                    role="group"
                    aria-label="Ereignistyp"
                >
                    <button
                        type="button"
                        className={styles.chip}
                        aria-pressed={activeType === null}
                        onClick={() => onTypeChange(null)}
                    >
                        Alle
                    </button>
                    {types.map((type) => (
                        <button
                            key={type}
                            type="button"
                            className={styles.chip}
                            aria-pressed={activeType === type}
                            onClick={() =>
                                onTypeChange(activeType === type ? null : type)
                            }
                        >
                            {ALERT_TYPE_CHIPS[type]}
                        </button>
                    ))}
                </div>
            )}
            <div className={styles.body}>
                {error && <RetryMessage message={error} onRetry={onRetry} />}
                {!error && isLoading && (
                    <p className={styles.note}>Ereignisse werden geladen…</p>
                )}
                {!error && !isLoading && alerts.length === 0 && (
                    <p className={styles.note}>Keine Ereignisse.</p>
                )}
                {alerts.length > 0 && (
                    <ul className={styles.list}>
                        {alerts.map((alert) => {
                            const running = isRunningEvent(alert);
                            const rowClass = [
                                styles.row,
                                running && alert.type === "SPEEDING"
                                    ? styles.rowRunning
                                    : undefined,
                                alert.vehicle_id === selectedVehicleId
                                    ? styles.rowSelected
                                    : undefined,
                            ]
                                .filter(Boolean)
                                .join(" ");

                            return (
                                <li key={alert.id}>
                                    <button
                                        type="button"
                                        className={rowClass}
                                        onClick={() => onPick(alert)}
                                    >
                                        <time
                                            className={styles.time}
                                            dateTime={alert.created_at}
                                            title={formatTimestamp(
                                                alert.created_at,
                                            )}
                                        >
                                            {formatEventTime(alert.created_at)}
                                        </time>
                                        <span className={styles.text}>
                                            <span className={styles.line}>
                                                <strong
                                                    className={
                                                        TYPE_CLASS[alert.type]
                                                    }
                                                >
                                                    {ALERT_TYPE_CHIPS[alert.type]}
                                                </strong>
                                                {" · "}
                                                <span className={styles.plate}>
                                                    {alert.license_plate}
                                                </span>
                                            </span>
                                            <span className={styles.detail}>
                                                {fleetEventDetail(alert)}
                                                {alert.driver_name &&
                                                    ` · ${alert.driver_name}`}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
            <div className={styles.foot}>
                <Link to={inboxHref}>Zu den Warnungen</Link>
            </div>
        </section>
    );
};
