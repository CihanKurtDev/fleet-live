import { useState } from "react";
import { ApiError } from "../../api/client";
import { downloadExport, type ExportKind } from "../../api/export";
import { MenuButton } from "../ui/Menu/MenuButton";
import { SwapLabel } from "../ui/Button/SwapLabel";
import styles from "./ExportButton.module.scss";

const ITEM_LABELS: Record<ExportKind, string> = {
    vehicles: "Fahrzeuge (CSV)",
    trips: "Fahrten (CSV)",
    alerts: "Warnungen (CSV)",
    period: "Monat (CSV)",
};

/** "Exportieren ▾" in a list page header; each item downloads one CSV. */
export function ExportMenu({ kinds }: { kinds: ExportKind[] }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const download = (kind: ExportKind) => {
        setError(null);
        setBusy(true);
        void downloadExport(kind)
            .catch((caught: unknown) => {
                setError(
                    caught instanceof ApiError
                        ? caught.message
                        : "Export ist fehlgeschlagen.",
                );
            })
            .finally(() => setBusy(false));
    };

    return (
        <span className={styles.wrap}>
            {error && (
                <span className={styles.error} role="alert">
                    {error}
                </span>
            )}
            <MenuButton
                label={
                    <SwapLabel swapped={busy} alt="Wird exportiert…">
                        Exportieren
                    </SwapLabel>
                }
                menuLabel="Exportieren"
                busy={busy}
                disabled={busy}
                items={kinds.map((kind) => ({
                    key: kind,
                    label: ITEM_LABELS[kind],
                    onSelect: () => download(kind),
                }))}
            />
        </span>
    );
}
