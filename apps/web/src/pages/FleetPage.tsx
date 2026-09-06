import { useNavigate } from "react-router";
import type { VehicleFilterId } from "@fleet-live/shared";

import { TableFilterBar } from "../components/ui/Table/TableFilterBar";
import { FleetDriverPicker } from "../components/vehicles/FleetDriverPicker";
import { FleetMap } from "../components/vehicles/FleetMap";
import { vehicleFilters } from "../components/vehicles/vehicleTableConfig";
import { useFleetPageQuery } from "../hooks/useFleetPageQuery";
import { useFleetPositions } from "../hooks/useFleetPositions";
import { formatCount } from "../utils/formatCount";
import styles from "./FleetPage.module.scss";

export const FleetPage = () => {
    const navigate = useNavigate();
    const {
        bbox,
        filter,
        search,
        drivers,
        searchDraft,
        setSearchDraft,
        setFilter,
        setDrivers,
        setBBox,
        searchParams,
    } = useFleetPageQuery();
    const { vehicles, truncated, isLoading, hasLoaded, error, snapshotLength } =
        useFleetPositions({
            bbox,
            filter,
            search,
            drivers,
        });

    const countLabel = `${formatCount(vehicles.length)} ${vehicles.length === 1 ? "Fahrzeug" : "Fahrzeuge"}`;
    const queryString = searchParams.toString();

    return (
        <section className={styles.page}>
            <h1 className={styles.title}>Flottenkarte</h1>
            <div className={styles.toolbar}>
                <input
                    type="search"
                    className={styles.search}
                    placeholder="Kennzeichen"
                    aria-label="Kennzeichen"
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                />

                <FleetDriverPicker
                    selected={drivers}
                    onChange={setDrivers}
                />

                <TableFilterBar
                    filters={vehicleFilters}
                    activeFilterId={filter ?? null}
                    onFilterChange={(id) =>
                        setFilter((id as VehicleFilterId | null) ?? undefined)
                    }
                    showAll
                    allLabel="Alle"
                    ariaLabel="Status"
                />

                <div className={styles.meta}>
                    {isLoading &&
                        snapshotLength === 0 &&
                        !truncated && (
                            <p className={styles.note}>
                                Positionen werden geladen…
                            </p>
                        )}
                    {hasLoaded && !error && !truncated && (
                        <p className={styles.count} aria-live="polite">
                            {countLabel}
                        </p>
                    )}
                    {error && (
                        <p className={styles.error} role="alert">
                            {error}
                        </p>
                    )}
                </div>
            </div>

            <div className={styles.mapArea}>
                <FleetMap
                    vehicles={vehicles}
                    initialBbox={bbox}
                    onBoundsChange={setBBox}
                    onSelect={(id) =>
                        navigate(`/vehicles/${id}`, {
                            state: {
                                from: `/fleet${
                                    queryString ? `?${queryString}` : ""
                                }`,
                            },
                        })
                    }
                />
                {hasLoaded &&
                    vehicles.length === 0 &&
                    !error && (
                        <p className={styles.empty} role="status">
                            {truncated
                                ? "Zu viele Fahrzeuge in diesem Ausschnitt. Zoome näher oder schränke die Auswahl ein."
                                : "Keine Fahrzeuge mit Position in diesem Ausschnitt."}
                        </p>
                    )}
            </div>
        </section>
    );
};
