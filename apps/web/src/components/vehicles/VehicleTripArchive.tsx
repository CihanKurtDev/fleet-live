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
    page: number;
    pageCount: number;
    limit: number;
    total: number;
    onPageChange: (page: number) => void;
    onLimitChange: (limit: number) => void;
    isLoading?: boolean;
}

export const VehicleTripArchive = ({
    trips,
    selectedTripId,
    onSelectTrip,
    page,
    pageCount,
    limit,
    total,
    onPageChange,
    onLimitChange,
    isLoading = false,
}: VehicleTripArchiveProps) => {
    const showPagination = total > 0 && page <= pageCount;

    return (
        <div className={styles.archive}>
            <Table
                columns={tripColumns}
                rows={trips}
                getRowKey={(row) => row.id}
                selectedRows={
                    selectedTripId === null ? [] : [selectedTripId]
                }
                onRowClick={(row) => onSelectTrip(row.id)}
                isLoading={isLoading}
                skeletonRowCount={Math.min(limit, 10)}
                emptyContent="Noch keine Fahrt aufgezeichnet. Die Linie erscheint, sobald das Fahrzeug unterwegs ist."
                caption="Fahrten"
                className={styles.tableWrap}
            />

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
