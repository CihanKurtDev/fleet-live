import { useNavigate } from "react-router";
import type { VehicleFilterId } from "@fleet-live/shared";

import { Input } from "../components/ui/Input/Input";
import { RetryMessage } from "../components/ui/RetryMessage";
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
    const {
        vehicles,
        densityCells,
        mode,
        total,
        isLoading,
        hasLoaded,
        error,
        retry,
        snapshotLength,
    } =
        useFleetPositions({
            bbox,
            filter,
            search,
            drivers,
        });

    const countLabel = `${formatCount(total)} ${total === 1 ? "Fahrzeug" : "Fahrzeuge"}`;
    const queryString = searchParams.toString();
    const focusPosition =
        search && mode === "positions" && total === 1
            ? (vehicles[0] ?? null)
            : null;

    return (
        <section className={styles.page}>
            <h1 className={styles.title}>Flottenkarte</h1>
            <div className={styles.toolbar}>
                <Input
                    type="search"
                    size="sm"
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
                        densityCells.length === 0 && (
                            <p className={styles.note}>
                                Positionen werden geladen…
                            </p>
                        )}
                    {hasLoaded && !error && (
                        <p className={styles.count} aria-live="polite">
                            {countLabel}
                        </p>
                    )}
                    {hasLoaded && !error && mode === "density" && (
                        <p className={styles.note}>
                            Dichteansicht: Kreisgröße zeigt die Fahrzeugzahl.
                            Klicken zum Vergrößern.
                        </p>
                    )}
                    {error && (
                        <RetryMessage message={error} onRetry={retry} />
                    )}
                </div>
            </div>

            <div className={styles.mapArea}>
                <FleetMap
                    vehicles={vehicles}
                    densityCells={densityCells}
                    mode={mode}
                    initialBbox={bbox}
                    focusKey={
                        focusPosition
                            ? `${search}\0${focusPosition.id}`
                            : null
                    }
                    focusPosition={focusPosition}
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
                    total === 0 &&
                    !error && (
                        <p className={styles.empty} role="status">
                            Keine Fahrzeuge mit Position in diesem Ausschnitt.
                        </p>
                    )}
            </div>
        </section>
    );
};
