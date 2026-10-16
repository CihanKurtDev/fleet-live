import { useState } from "react";
import { ApiError } from "../../api/client";
import { downloadExport, type ExportKind } from "../../api/export";
import { Button } from "../ui/Button/Button";
import styles from "./ExportButton.module.scss";

const LABELS: Record<ExportKind, { label: string; aria: string }> = {
    vehicles: {
        label: "Exportieren",
        aria: "Alle Fahrzeuge der Firma als CSV",
    },
    alerts: {
        label: "Exportieren",
        aria: "Alle Warnungen der Firma als CSV",
    },
    trips: {
        label: "Fahrten",
        aria: "Alle Fahrten der Firma als CSV",
    },
    period: {
        label: "Monat",
        aria: "Diesen Monat als CSV: Kilometer, angelegte Warnungen und Verbrauch",
    },
};

export function ExportButton({
    kind,
    size = "sm",
}: {
    kind: ExportKind;
    size?: "sm" | "toolbar";
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const copy = LABELS[kind];

    const onClick = () => {
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
            <Button
                variant="secondary"
                size={size}
                disabled={busy}
                busy={busy}
                busyLabel="Wird exportiert…"
                aria-label={copy.aria}
                onClick={onClick}
            >
                {copy.label}
            </Button>
            {error && (
                <span className={styles.error} role="alert">
                    {error}
                </span>
            )}
        </span>
    );
}
