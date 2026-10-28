import type { TripListItem } from "@fleet-live/shared";
import { TRIP_PAGE_LIMITS } from "@fleet-live/shared";

import { Table } from "../ui/Table/Table";
import { TablePagination } from "../ui/Table/TablePagination";
import { tripColumns } from "./tripTableConfig";
import styles from "./VehicleTripArchive.module.scss";

interface VehicleTripArchiveProps {
    trips: TripListItem[];
    selectedTripId: number | null;
    onSelectTrip: (tripId: number) => void;
    /** A row is about to be picked (pointer over it, or focused). */
    onTripIntent?: (trip: TripListItem) => void;
    page: number;
    pageCount: number;
    limit: number;
    total: number;
    onPageChange: (page: number) => void;
    onLimitChange: (limit: number) => void;
    isLoading?: boolean;
    /** Take the parent's remaining height; rows scroll, pagination stays. */
    fill?: boolean;
}

export const VehicleTripArchive = ({
    trips,
    selectedTripId,
    onSelectTrip,
    onTripIntent,
    page,
    pageCount,
    limit,
    total,
    onPageChange,
    onLimitChange,
    isLoading = false,
    fill = false,
}: VehicleTripArchiveProps) => {
    const showPagination = total > 0 && page <= pageCount;

    return (
        <div
            className={
                fill ? `${styles.archive} ${styles.fill}` : styles.archive
            }
        >
            <div className={styles.scroll}>
                <Table
                    columns={tripColumns}
                    rows={trips}
                    getRowKey={(row) => row.id}
                    selectedRows={
                        selectedTripId === null ? [] : [selectedTripId]
                    }
                    onRowClick={(row) => onSelectTrip(row.id)}
                    onRowIntent={onTripIntent}
                    isLoading={isLoading}
                    skeletonRowCount={Math.min(limit, 10)}
                    emptyContent="Noch keine Fahrt aufgezeichnet. Die Linie erscheint, sobald das Fahrzeug unterwegs ist."
                    caption="Fahrten"
                    className={styles.table}
                />
            </div>

            {showPagination && (
                <TablePagination
                    page={page}
                    pageCount={pageCount}
                    limit={limit}
                    total={total}
                    onPageChange={onPageChange}
                    onLimitChange={onLimitChange}
                    limitOptions={TRIP_PAGE_LIMITS}
                />
            )}
        </div>
    );
};
