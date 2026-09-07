import type { Trip } from "@fleet-live/shared";

import { Button } from "../ui/Button/Button";
import { formatTimestamp } from "../../utils/dateTime";
import styles from "./VehicleTripArchive.module.scss";

const formatKilometers = (meters: number) =>
    `${(meters / 1_000).toLocaleString("de-DE", {
        maximumFractionDigits: 1,
    })} km`;

interface VehicleTripArchiveProps {
    trips: Trip[];
    selectedTripId: number | null;
    onSelectTrip: (tripId: number) => void;
    page: number;
    pageCount: number;
    total: number;
    onPageChange: (page: number) => void;
    isLoading?: boolean;
}

export const VehicleTripArchive = ({
    trips,
    selectedTripId,
    onSelectTrip,
    page,
    pageCount,
    total,
    onPageChange,
    isLoading = false,
}: VehicleTripArchiveProps) => {
    if (isLoading) {
        return <p className={styles.empty}>Fahrten werden geladen…</p>;
    }

    if (total === 0) {
        return (
            <p className={styles.empty}>
                Noch keine Fahrt aufgezeichnet. Die Linie erscheint, sobald
                das Fahrzeug unterwegs ist.
            </p>
        );
    }

    return (
        <div className={styles.archive}>
            <ul className={styles.list}>
                {trips.map((trip) => {
                    const isOpen = trip.ended_at === null;
                    const isSelected = trip.id === selectedTripId;

                    return (
                        <li key={trip.id}>
                            <button
                                type="button"
                                className={styles.item}
                                data-selected={isSelected || undefined}
                                data-open={isOpen || undefined}
                                onClick={() => onSelectTrip(trip.id)}
                            >
                                <span className={styles.when}>
                                    {formatTimestamp(trip.started_at)}
                                    {isOpen
                                        ? " · läuft"
                                        : trip.ended_at
                                          ? ` – ${formatTimestamp(trip.ended_at)}`
                                          : ""}
                                </span>
                                <span className={styles.stats}>
                                    {formatKilometers(trip.distance_m)} · Spitze{" "}
                                    {Math.round(trip.max_speed)} km/h
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>

            {pageCount > 1 && (
                <div className={styles.pagination}>
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => onPageChange(page - 1)}
                    >
                        Zurück
                    </Button>
                    <span className={styles.pageLabel}>
                        Seite {page} von {pageCount}
                    </span>
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={page >= pageCount}
                        onClick={() => onPageChange(page + 1)}
                    >
                        Weiter
                    </Button>
                </div>
            )}
        </div>
    );
};
