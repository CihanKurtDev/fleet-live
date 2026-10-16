import { useEffect, useState } from "react";
import { formatAlertEvent, type Alert } from "@fleet-live/shared";

import { isAbortError } from "../../api/client";
import { listAlerts, resolveAlert } from "../../api/alerts";
import { retryTransient } from "../../api/retryTransient";
import { useVehicles } from "../../context/vehiclesContext";
import { formatEventTime } from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import { TablePagination } from "../ui/Table/TablePagination";
import detail from "./driverDetail.module.scss";
import styles from "./DriverWarningsPanel.module.scss";

/** Rows per page: the panel keeps this height. */
export const DRIVER_WARNINGS_PAGE_SIZE = 5;

interface DriverWarningsPanelProps {
    driverId: number;
    canWrite: boolean;
    /**
     * Speeding count from the driver record. Known before the list loads, so
     * the pager's space is there from the start and nothing below moves.
     */
    expectedTotal?: number;
}

type Loaded = { key: string; data: Alert[]; total: number; pageCount: number };

/**
 * Speeding warnings of this driver, newest first. The rows do not navigate;
 * dispatchers resolve open ones with the row button.
 */
export const DriverWarningsPanel = ({
    driverId,
    canWrite,
    expectedTotal = 0,
}: DriverWarningsPanelProps) => {
    const { listEpoch, refetchLists } = useVehicles();
    const [page, setPage] = useState(1);
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [resolvingId, setResolvingId] = useState<number | null>(null);

    const requestKey = `${driverId}\0${page}\0${listEpoch}`;

    useEffect(() => {
        const controller = new AbortController();

        retryTransient(
            () =>
                listAlerts(
                    {
                        filter: "all",
                        type: "SPEEDING",
                        sort: "created_at",
                        dir: "desc",
                        page,
                        limit: DRIVER_WARNINGS_PAGE_SIZE,
                        driver_id: driverId,
                    },
                    controller.signal,
                ),
            controller.signal,
        )
            .then((response) => {
                setLoaded({
                    key: requestKey,
                    data: response.data,
                    total: response.meta.total,
                    pageCount: response.meta.pageCount,
                });
                setError(null);
            })
            .catch((caught: unknown) => {
                if (controller.signal.aborted || isAbortError(caught)) {
                    return;
                }

                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Tempo-Warnungen konnten nicht geladen werden.",
                );
            });

        return () => controller.abort();
    }, [driverId, page, listEpoch, requestKey]);

    const handleResolve = async (id: number) => {
        setResolvingId(id);
        setError(null);

        try {
            await resolveAlert(id);
            refetchLists();
        } catch (caught: unknown) {
            setError(
                caught instanceof Error
                    ? caught.message
                    : "Warnung konnte nicht erledigt werden.",
            );
        } finally {
            setResolvingId(null);
        }
    };

    const rows = loaded?.data ?? [];
    const total = loaded?.total ?? expectedTotal;

    return (
        <section className={detail.panel} aria-label="Tempo-Warnungen">
            <div className={detail.panelHeader}>
                <h2 className={detail.panelTitle}>
                    Tempo-Warnungen{" "}
                    {total > 0 && (
                        <span className={detail.count}>
                            {total.toLocaleString("de-DE")}
                        </span>
                    )}
                </h2>
            </div>

            {error && (
                <p className={detail.error} role="alert">
                    {error}
                </p>
            )}

            <div className={styles.rows}>
                {loaded === null ? (
                    !error && <p className={detail.empty}>Wird geladen…</p>
                ) : rows.length === 0 ? (
                    <p className={detail.empty}>Keine Tempo-Warnungen.</p>
                ) : (
                    <ul className={styles.list}>
                        {rows.map((alert) => {
                            const open = alert.resolved_at === null;

                            return (
                                <li key={alert.id} className={styles.row}>
                                    <span className={styles.time}>
                                        {formatEventTime(alert.created_at)}
                                    </span>
                                    <span className={styles.plate}>
                                        {alert.license_plate}
                                    </span>
                                    <span className={styles.event}>
                                        {formatAlertEvent(alert)}
                                    </span>
                                    <span
                                        className={styles.state}
                                        data-open={open}
                                    >
                                        {open ? "offen" : "erledigt"}
                                    </span>
                                    <span className={styles.action}>
                                        {canWrite && open && (
                                            <Button
                                                variant="secondary"
                                                size="row"
                                                disabled={
                                                    resolvingId === alert.id
                                                }
                                                onClick={() =>
                                                    void handleResolve(alert.id)
                                                }
                                            >
                                                Erledigen
                                            </Button>
                                        )}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {total > DRIVER_WARNINGS_PAGE_SIZE && (
                <div className={styles.footer}>
                    <TablePagination
                        layout="footer"
                        page={page}
                        pageCount={
                            loaded?.pageCount ??
                            Math.ceil(total / DRIVER_WARNINGS_PAGE_SIZE)
                        }
                        limit={DRIVER_WARNINGS_PAGE_SIZE}
                        total={total}
                        onPageChange={setPage}
                    />
                </div>
            )}
        </section>
    );
};
