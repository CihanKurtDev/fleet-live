import {
    berlinTodayIso,
    dueExplanationText,
    explainLicenceCheck,
    explainLicenceExpiry,
    speedBand,
} from "@fleet-live/shared";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { deleteDriver } from "../api/drivers";
import { DriverAssignmentPanel } from "../components/drivers/DriverAssignmentPanel";
import { DriverEditForm } from "../components/drivers/DriverEditForm";
import { DriverHintsPanel } from "../components/drivers/DriverHintsPanel";
import type { DriverFormField } from "../components/drivers/driverHints";
import { defaultCheckMonths } from "../components/drivers/driverHints";
import { DriverMoreMenu } from "../components/drivers/DriverMoreMenu";
import { DriverOpenWarningsPill } from "../components/drivers/DriverTableCells";
import { DriverWarningsPanel } from "../components/drivers/DriverWarningsPanel";
import {
    deleteErrorMessage,
    driverCountText,
    driverDeleteTitle,
} from "../components/drivers/driverDelete";
import detail from "../components/drivers/driverDetail.module.scss";
import { DetailBackLink } from "../components/navigation/DetailBackLink";
import { backLabel } from "../components/navigation/detailBack";
import { useDetailBack } from "../components/navigation/useDetailBack";
import { SPEED_BAND_COLORS } from "../components/vehicles/speedBand";
import { VehicleStatusChip } from "../components/vehicles/VehicleStatusChip";
import { Button } from "../components/ui/Button/Button";
import { ConfirmDialog } from "../components/ui/Modal/ConfirmDialog";
import { Modal } from "../components/ui/Modal/Modal";
import { RetryMessage } from "../components/ui/RetryMessage";
import { useVehicles } from "../context/vehiclesContext";
import { useAuth } from "../hooks/useAuth";
import { useDriver } from "../hooks/useDriver";
import { useDueSettings } from "../hooks/useDueSettings";
import { useVehicle } from "../hooks/useVehicle";
import { formatIsoDate } from "../utils/dateTime";
import styles from "./DriverDetailPage.module.scss";

export const DriverDetailPage = () => {
    const { id } = useParams();
    const { from, navigate } = useDetailBack("/drivers");
    const { user } = useAuth();
    const { settings: dueSettings } = useDueSettings();
    const { refetchLists } = useVehicles();
    const canWrite = user?.role === "dispatcher";
    const driverId = Number(id);
    const parsedId = Number.isInteger(driverId) ? driverId : null;
    const { driver, isLoading, error, retry, notFound } = useDriver(parsedId);
    const [isEditing, setIsEditing] = useState(false);
    const [editField, setEditField] = useState<DriverFormField | undefined>();
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // The speed only exists on the vehicle, and only while it drives.
    const currentVehicleId =
        driver?.current_vehicle?.status === "DRIVING"
            ? driver.current_vehicle.id
            : null;
    const { vehicle: drivingVehicle } = useVehicle(currentVehicleId);

    if (isLoading && !driver) {
        return (
            <section className={styles.page}>
                <p>Fahrer wird geladen…</p>
            </section>
        );
    }

    if (error) {
        return (
            <section className={styles.page}>
                <DetailBackLink fallback="/drivers" />
                <h1 className={styles.title}>Fahrer konnte nicht geladen werden.</h1>
                <RetryMessage message={error} onRetry={retry} />
            </section>
        );
    }

    if (!driver || notFound) {
        return (
            <section className={styles.page}>
                <DetailBackLink fallback="/drivers" />
                <h1 className={styles.title}>Fahrer nicht gefunden</h1>
                <p>
                    Es gibt keinen Fahrer mit der Kennung <code>{id}</code>.
                </p>
            </section>
        );
    }

    const current = driver.current_vehicle;
    const checkMonths =
        dueSettings?.check_months ?? defaultCheckMonths();
    const liveSpeed =
        drivingVehicle && drivingVehicle.speed !== null
            ? {
                  speed: drivingVehicle.speed,
                  band: speedBand({
                      speed: drivingVehicle.speed,
                      status: drivingVehicle.status,
                      speeding_open: drivingVehicle.speeding_open,
                      limit_kmh: drivingVehicle.speed_limit_kmh,
                  }).band,
              }
            : null;

    const releases = driver.vehicles.length;
    const summary = [
        current ? `fährt ${current.license_plate}` : "kein aktuelles Fahrzeug",
        releases === 0
            ? "darf kein Fahrzeug fahren"
            : `darf ${releases} ${releases === 1 ? "Fahrzeug" : "Fahrzeuge"} fahren`,
        driver.phone ? null : "Telefon fehlt",
    ].filter((part): part is string => part !== null);

    const backLink = from.startsWith("/drivers") ? "← Fahrer" : backLabel(from);

    const requestDelete = () => {
        setDeleteError(null);
        setConfirmDelete(true);
    };

    const handleDelete = async () => {
        setDeleteError(null);
        setIsDeleting(true);

        try {
            await deleteDriver(driver.id);
            navigate(from, {
                state: { notice: `${driverCountText(1)} gelöscht.` },
            });
            refetchLists();
        } catch (caught: unknown) {
            setDeleteError(deleteErrorMessage(caught));
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <section className={styles.page}>
            <header className={styles.header}>
                <Link className={styles.back} to={from}>
                    {backLink}
                </Link>
                <h1 className={styles.title}>{driver.name}</h1>
                <DriverOpenWarningsPill count={driver.open_warnings} />
                <p className={styles.summary}>{summary.join(" · ")}</p>
                {canWrite && (
                    <div className={styles.actions}>
                        <Button
                            variant="secondary"
                            size="toolbar"
                            onClick={() => {
                                setEditField(undefined);
                                setIsEditing(true);
                            }}
                        >
                            Bearbeiten
                        </Button>
                        <DriverMoreMenu onDelete={requestDelete} />
                    </div>
                )}
            </header>

            <div className={styles.cockpit}>
                <div className={styles.side}>
                    <section className={detail.panel} aria-label="Jetzt">
                        <div className={detail.panelHeader}>
                            <h2 className={detail.panelTitle}>Jetzt</h2>
                        </div>
                        <dl className={styles.now}>
                            <div>
                                <dt>Fahrzeug</dt>
                                <dd className={styles.nowValue}>
                                    {current ? (
                                        current.license_plate
                                    ) : (
                                        <span className={styles.quiet}>—</span>
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt>Status</dt>
                                <dd>
                                    {current ? (
                                        <VehicleStatusChip
                                            status={current.status}
                                        />
                                    ) : (
                                        <span className={styles.quiet}>
                                            Kein Fahrzeug
                                        </span>
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt>Tempo</dt>
                                <dd className={styles.nowValue}>
                                    {liveSpeed ? (
                                        <>
                                            <span
                                                style={{
                                                    color: SPEED_BAND_COLORS[
                                                        liveSpeed.band
                                                    ],
                                                }}
                                            >
                                                {liveSpeed.speed}
                                            </span>{" "}
                                            <span className={styles.unit}>
                                                km/h
                                            </span>
                                        </>
                                    ) : (
                                        <span className={styles.quiet}>—</span>
                                    )}
                                </dd>
                            </div>
                        </dl>
                    </section>

                    <DriverHintsPanel
                        driver={driver}
                        canWrite={canWrite}
                        checkMonths={checkMonths}
                        onEdit={(field) => {
                            setEditField(field);
                            setIsEditing(true);
                        }}
                    />

                    <section className={detail.panel} aria-label="Stammdaten">
                        <h2 className={detail.panelTitle}>Stammdaten</h2>
                        <dl className={styles.facts}>
                            <div>
                                <dt>Telefon</dt>
                                <dd>{driver.phone ?? "—"}</dd>
                            </div>
                            <div>
                                <dt>Führerschein bis</dt>
                                <dd>{formatIsoDate(driver.licence_expires_on)}</dd>
                            </div>
                            <div>
                                <dt>Kontrolliert am</dt>
                                <dd>{formatIsoDate(driver.licence_checked_on)}</dd>
                            </div>
                        </dl>
                        <p className={detail.note}>
                            Frühester Klassenablauf, zum Beispiel C/CE.{" "}
                            {dueExplanationText(
                                "licence_expiry",
                                explainLicenceExpiry(driver.licence_expires_on),
                            )}{" "}
                            {dueExplanationText(
                                "licence_check",
                                explainLicenceCheck({
                                    checkedOn: driver.licence_checked_on,
                                    today: berlinTodayIso(),
                                    intervalMonths: checkMonths,
                                }),
                            )}
                        </p>
                    </section>
                </div>

                <div className={styles.main}>
                    <DriverWarningsPanel
                        key={driver.id}
                        driverId={driver.id}
                        canWrite={canWrite}
                        expectedTotal={driver.counts.SPEEDING}
                    />
                    <DriverAssignmentPanel driver={driver} canWrite={canWrite} />
                </div>
            </div>

            <Modal
                open={canWrite && isEditing}
                onClose={() => setIsEditing(false)}
                title="Fahrer bearbeiten"
            >
                <DriverEditForm
                    driver={driver}
                    focusField={editField}
                    onCancel={() => setIsEditing(false)}
                    onSaved={() => {
                        refetchLists();
                        setIsEditing(false);
                    }}
                />
            </Modal>

            <ConfirmDialog
                open={canWrite && confirmDelete}
                onClose={() => {
                    setConfirmDelete(false);
                    setDeleteError(null);
                }}
                title={driverDeleteTitle(1)}
                confirmLabel="Löschen"
                busyLabel="Wird gelöscht…"
                isBusy={isDeleting}
                onConfirm={handleDelete}
                itemsLabel="Ausgewählter Fahrer"
                items={[
                    {
                        key: driver.id,
                        name: driver.name,
                        detail: current?.license_plate ?? "kein Fahrzeug",
                    },
                ]}
                error={deleteError}
            >
                <p>
                    Diesen Fahrer wirklich löschen? Das kann nicht rückgängig
                    gemacht werden.
                </p>
            </ConfirmDialog>
        </section>
    );
};
