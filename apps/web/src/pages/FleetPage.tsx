import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
    DEPOT_RADIUS_DEFAULT_M,
    type Site,
    type VehicleFilterId,
} from "@fleet-live/shared";

import { ApiError, isAbortError } from "../api/client";
import {
    createSite,
    deleteSite,
    listSites,
    updateSite,
} from "../api/sites";
import { ConfirmDialog } from "../components/ui/Modal/ConfirmDialog";
import { Input } from "../components/ui/Input/Input";
import { RetryMessage } from "../components/ui/RetryMessage";
import { TableFilterBar } from "../components/ui/Table/TableFilterBar";
import { DepotPanel } from "../components/vehicles/DepotPanel";
import {
    isDepotDraftDirty,
    type DepotDraft,
} from "../components/vehicles/depotDraft";
import { FleetDriverPicker } from "../components/vehicles/FleetDriverPicker";
import { FleetMap } from "../components/vehicles/FleetMap";
import { vehicleFilters } from "../components/vehicles/vehicleTableConfig";
import { useVehicles } from "../context/vehiclesContext";
import { useAuth } from "../hooks/useAuth";
import { useFleetPageQuery } from "../hooks/useFleetPageQuery";
import { useFleetPositions } from "../hooks/useFleetPositions";
import { formatCount } from "../utils/formatCount";
import styles from "./FleetPage.module.scss";

const sortSites = (sites: Site[]) =>
    [...sites].sort(
        (left, right) =>
            left.name.localeCompare(right.name, "de") || left.id - right.id,
    );

export const FleetPage = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { listEpoch } = useVehicles();
    const canEdit = user?.role === "dispatcher";
    const {
        bbox,
        filter,
        search,
        drivers,
        depotId,
        searchDraft,
        setSearchDraft,
        setFilter,
        setDrivers,
        setBBox,
        setDepot,
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
    } = useFleetPositions({
        bbox,
        filter,
        search,
        drivers,
    });
    const [sites, setSites] = useState<Site[]>([]);
    const [sitesError, setSitesError] = useState<string | null>(null);
    const [sitesRetryKey, setSitesRetryKey] = useState(0);
    const [draft, setDraft] = useState<DepotDraft | null>(null);
    const [placing, setPlacing] = useState(false);
    const [focusNonce, setFocusNonce] = useState(0);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<Site | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        const controller = new AbortController();

        listSites(controller.signal)
            .then((response) => {
                setSites(response.data);
                setSitesError(null);
            })
            .catch((caught: unknown) => {
                if (isAbortError(caught)) {
                    return;
                }

                setSitesError("Depots konnten nicht geladen werden.");
            });

        return () => controller.abort();
    }, [listEpoch, sitesRetryKey]);

    const countLabel = `${formatCount(total)} ${total === 1 ? "Fahrzeug" : "Fahrzeuge"}`;
    const queryString = searchParams.toString();
    const focusPosition =
        search && mode === "positions" && total === 1
            ? (vehicles[0] ?? null)
            : null;
    const draftDirty = draft !== null && isDepotDraftDirty(draft, sites);

    const selectDepot = (site: Site) => {
        if (draft && isDepotDraftDirty(draft, sites)) {
            return;
        }

        setDraft(null);
        setPlacing(false);
        setSaveError(null);
        setDepot(site.id);
        setFocusNonce((current) => current + 1);
    };

    const editDepot = (site: Site) => {
        setPlacing(false);
        setSaveError(null);
        setDepot(site.id);
        setFocusNonce((current) => current + 1);
        setDraft({
            id: site.id,
            name: site.name,
            latitude: site.latitude,
            longitude: site.longitude,
            radius_m: site.radius_m,
        });
    };

    const saveDraft = async () => {
        if (!draft || draft.name.trim().length === 0) {
            return;
        }

        const input = {
            name: draft.name.trim(),
            latitude: draft.latitude,
            longitude: draft.longitude,
            radius_m: draft.radius_m,
        };

        setIsSaving(true);
        setSaveError(null);

        try {
            if (draft.id === "new") {
                const created = await createSite(input);
                setSites((current) => sortSites([...current, created]));
                setDepot(created.id);
                setFocusNonce((current) => current + 1);
            } else {
                const updated = await updateSite(draft.id, input);
                setSites((current) =>
                    sortSites(
                        current.map((site) =>
                            site.id === updated.id ? updated : site,
                        ),
                    ),
                );
            }

            setDraft(null);
            setPlacing(false);
        } catch (caught) {
            setSaveError(
                caught instanceof ApiError
                    ? caught.message
                    : "Depot konnte nicht gespeichert werden.",
            );
        } finally {
            setIsSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) {
            return;
        }

        setIsDeleting(true);

        try {
            await deleteSite(deleteTarget.id);
            setSites((current) =>
                current.filter((site) => site.id !== deleteTarget.id),
            );
            if (depotId === deleteTarget.id) {
                setDepot(null);
            }
            setDraft(null);
            setDeleteTarget(null);
        } catch (caught) {
            setSaveError(
                caught instanceof ApiError
                    ? caught.message
                    : "Depot konnte nicht gelöscht werden.",
            );
            setDeleteTarget(null);
        } finally {
            setIsDeleting(false);
        }
    };

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
                    depots={sites}
                    draft={draft}
                    selectedDepotId={depotId ?? null}
                    focusDepot={
                        depotId
                            ? { id: depotId, nonce: focusNonce }
                            : null
                    }
                    placing={placing}
                    canEditDepots={canEdit}
                    lockDepotSelection={draftDirty}
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
                    onPlaceDepot={(latitude, longitude) => {
                        setDraft({
                            id: "new",
                            name: "",
                            latitude,
                            longitude,
                            radius_m: DEPOT_RADIUS_DEFAULT_M,
                        });
                        setPlacing(false);
                        setSaveError(null);
                    }}
                    onMoveDepot={(id, latitude, longitude) => {
                        setDraft((current) =>
                            current && current.id === id
                                ? { ...current, latitude, longitude }
                                : current,
                        );
                    }}
                    onSelectDepot={(id) => {
                        const site = sites.find((item) => item.id === id);

                        if (site) {
                            selectDepot(site);
                        }
                    }}
                />
                <DepotPanel
                    sites={sites}
                    selectedId={depotId ?? null}
                    draft={canEdit ? draft : null}
                    placing={placing}
                    canEdit={canEdit}
                    saveError={saveError}
                    loadError={sitesError}
                    isSaving={isSaving}
                    revealToken={focusNonce}
                    onRetryLoad={() =>
                        setSitesRetryKey((current) => current + 1)
                    }
                    onSelect={selectDepot}
                    onEdit={editDepot}
                    onStartPlace={() => {
                        if (draft && isDepotDraftDirty(draft, sites)) {
                            return;
                        }

                        setPlacing((current) => !current);
                        setDraft(null);
                        setSaveError(null);
                    }}
                    onCancel={() => {
                        setDraft(null);
                        setPlacing(false);
                        setSaveError(null);
                    }}
                    onDraftChange={setDraft}
                    onSave={() => {
                        void saveDraft();
                    }}
                    onAskDelete={setDeleteTarget}
                />
                {hasLoaded && total === 0 && !error && (
                    <p className={styles.empty} role="status">
                        Keine Fahrzeuge mit Position in diesem Ausschnitt.
                    </p>
                )}
            </div>
            <ConfirmDialog
                open={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                title="Depot löschen?"
                confirmLabel="Löschen"
                isBusy={isDeleting}
                onConfirm={confirmDelete}
            >
                {deleteTarget && (
                    <p>
                        {deleteTarget.home_count === 0
                            ? `„${deleteTarget.name}“ ist bei keinem Fahrzeug der Stammstandort.`
                            : `${deleteTarget.home_count} ${
                                  deleteTarget.home_count === 1
                                      ? "Fahrzeug hat"
                                      : "Fahrzeuge haben"
                              } „${deleteTarget.name}“ als Stammstandort. Die Fahrzeuge bleiben, der Stammstandort wird geleert.`}
                    </p>
                )}
            </ConfirmDialog>
        </section>
    );
};
