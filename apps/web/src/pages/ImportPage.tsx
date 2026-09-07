import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import {
    IMPORT_COLUMN_TARGETS,
    IMPORT_ROW_ACTIONS,
    VEHICLE_STATUSES,
    type ImportColumnMapping,
    type ImportColumnTarget,
    type ImportPreviewResponse,
    type ImportRowAction,
    type ImportStatusMapping,
} from "@fleet-live/shared";

import { commitImport, previewImport } from "../api/import";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/Button/Button";
import { useAuth } from "../hooks/useAuth";
import { vehicleStatusLabel } from "../components/vehicles/vehicleStatus";
import styles from "./ImportPage.module.scss";

type WizardStep = "upload" | "mapping" | "preview" | "result";

const COLUMN_TARGET_LABELS: Record<ImportColumnTarget, string> = {
    license_plate: "Kennzeichen",
    fuel_level: "Tankstand (%)",
    status: "Status",
    driver_name: "Fahrer",
    ignore: "Ignorieren",
};

const ROW_ACTION_LABELS: Record<ImportRowAction, string> = {
    create: "Neu anlegen",
    update: "Aktualisieren",
    skip: "Überspringen",
};

const STEP_LABELS: Record<WizardStep, string> = {
    upload: "Datei",
    mapping: "Spalten",
    preview: "Vorschau",
    result: "Ergebnis",
};

const STEP_ORDER: WizardStep[] = ["upload", "mapping", "preview", "result"];

function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, "UTF-8");
    });
}

function stepState(
    current: WizardStep,
    step: WizardStep,
): "done" | "active" | "upcoming" {
    const currentIndex = STEP_ORDER.indexOf(current);
    const stepIndex = STEP_ORDER.indexOf(step);

    if (stepIndex < currentIndex) {
        return "done";
    }

    if (stepIndex === currentIndex) {
        return "active";
    }

    return "upcoming";
}

export const ImportPage = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const canWrite = user?.role === "dispatcher";

    const [step, setStep] = useState<WizardStep>("upload");
    const [csvContent, setCsvContent] = useState("");
    const [fileName, setFileName] = useState<string | null>(null);
    const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
    const [columnMapping, setColumnMapping] = useState<ImportColumnMapping>({});
    const [statusMapping, setStatusMapping] = useState<ImportStatusMapping>({});
    const [rowActions, setRowActions] = useState<
        Record<number, ImportRowAction>
    >({});
    const [commitSummary, setCommitSummary] = useState<
        Awaited<ReturnType<typeof commitImport>>["data"] | null
    >(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const unmappedStatuses = preview?.unmapped_status_values ?? [];

    const effectiveRowActions = useMemo(() => {
        if (!preview) {
            return {};
        }

        const actions: Record<number, ImportRowAction> = {};
        for (const row of preview.rows) {
            actions[row.row_index] =
                rowActions[row.row_index] ?? row.default_action;
        }
        return actions;
    }, [preview, rowActions]);

    if (!canWrite) {
        return <Navigate to="/vehicles" replace />;
    }

    const handleFileChange = async (
        event: React.ChangeEvent<HTMLInputElement>,
    ) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        setError(null);
        try {
            const text = await readFileAsText(file);
            setCsvContent(text);
            setFileName(file.name);
            setPreview(null);
            setCommitSummary(null);
            setRowActions({});
        } catch {
            setError("Die Datei konnte nicht gelesen werden.");
        }
    };

    const runPreview = async (
        nextStep: WizardStep,
        mapping = columnMapping,
        statuses = statusMapping,
    ) => {
        if (!csvContent.trim()) {
            setError("Bitte zuerst eine CSV-Datei auswählen.");
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await previewImport({
                csv: csvContent,
                column_mapping: mapping,
                status_mapping: statuses,
            });
            const data = response.data;

            setPreview(data);
            setColumnMapping(
                Object.keys(mapping).length > 0
                    ? mapping
                    : data.suggested_mapping,
            );
            setStatusMapping(statuses);
            setRowActions({});
            setStep(nextStep);
        } catch (caught) {
            setError(
                caught instanceof ApiError
                    ? caught.message
                    : "Vorschau fehlgeschlagen.",
            );
        } finally {
            setIsLoading(false);
        }
    };

    const handleMappingNext = async () => {
        const hasPlate = Object.values(columnMapping).includes("license_plate");
        if (!hasPlate) {
            setError("Mindestens eine Spalte muss „Kennzeichen“ zugeordnet werden.");
            return;
        }

        await runPreview("preview", columnMapping, statusMapping);
    };

    const handleUploadNext = async () => {
        await runPreview("mapping");
    };

    const handleCommit = async () => {
        if (!preview?.preview_id) {
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const payload = Object.fromEntries(
                Object.entries(effectiveRowActions).map(([index, action]) => [
                    index,
                    action,
                ]),
            );

            const response = await commitImport({
                preview_id: preview.preview_id,
                row_actions: payload,
            });

            setCommitSummary(response.data);
            setStep("result");
        } catch (caught) {
            setError(
                caught instanceof ApiError
                    ? caught.message
                    : "Import fehlgeschlagen.",
            );
        } finally {
            setIsLoading(false);
        }
    };

    const downloadErrorCsv = () => {
        if (!commitSummary || commitSummary.errors.length === 0) {
            return;
        }

        const lines = [
            "Zeile;Fehler",
            ...commitSummary.errors.map(
                (entry) => `${entry.row_index};${entry.message.replace(/;/g, ",")}`,
            ),
        ];
        const blob = new Blob([lines.join("\n")], {
            type: "text/csv;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "import-fehler.csv";
        anchor.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className={styles.importPage}>
            <header className={styles.header}>
                <h1 className={styles.title}>Bestand importieren</h1>
                <p className={styles.lead}>
                    Fahrzeuge und optional Fahrer aus einer CSV-Datei laden.
                    Telemetrie, Fahrten und Warnungen werden nicht importiert.
                </p>
                <div className={styles.steps}>
                    {STEP_ORDER.map((wizardStep) => {
                        const state = stepState(step, wizardStep);
                        const className =
                            state === "active"
                                ? styles.stepChipActive
                                : state === "done"
                                  ? styles.stepChipDone
                                  : styles.stepChip;

                        return (
                            <span key={wizardStep} className={className}>
                                {STEP_LABELS[wizardStep]}
                            </span>
                        );
                    })}
                </div>
            </header>

            {error && <div className={styles.errorBanner}>{error}</div>}

            {step === "upload" && (
                <section className={styles.panel}>
                    <h2 className={styles.panelTitle}>1. Datei hochladen</h2>
                    <p className={styles.hint}>
                        CSV mit Semikolon oder Komma. Excel: als CSV speichern.
                    </p>
                    <input
                        className={styles.fileInput}
                        type="file"
                        accept=".csv,text/csv"
                        onChange={handleFileChange}
                    />
                    {fileName && (
                        <p className={styles.hint}>Ausgewählt: {fileName}</p>
                    )}
                    <div className={styles.actions}>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => navigate("/vehicles")}
                        >
                            Abbrechen
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={!csvContent.trim() || isLoading}
                            onClick={handleUploadNext}
                        >
                            Weiter
                        </Button>
                    </div>
                </section>
            )}

            {step === "mapping" && preview && (
                <section className={styles.panel}>
                    <h2 className={styles.panelTitle}>2. Spalten zuordnen</h2>
                    <p className={styles.hint}>
                        {preview.columns.length} Spalten erkannt.
                    </p>
                    <div className={styles.mappingGrid}>
                        {preview.columns.map((column) => (
                            <div key={column} className={styles.mappingRow}>
                                <span className={styles.mappingLabel}>
                                    {column}
                                </span>
                                <select
                                    className={styles.select}
                                    value={columnMapping[column] ?? "ignore"}
                                    onChange={(event) => {
                                        const value = event.target
                                            .value as ImportColumnTarget;
                                        setColumnMapping((current) => ({
                                            ...current,
                                            [column]: value,
                                        }));
                                    }}
                                >
                                    {IMPORT_COLUMN_TARGETS.map((target) => (
                                        <option key={target} value={target}>
                                            {COLUMN_TARGET_LABELS[target]}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>

                    {unmappedStatuses.length > 0 && (
                        <div className={styles.statusMapping}>
                            <h3 className={styles.panelTitle}>
                                Statuswerte zuordnen
                            </h3>
                            {unmappedStatuses.map((raw) => (
                                <div
                                    key={raw}
                                    className={styles.mappingRow}
                                >
                                    <span className={styles.mappingLabel}>
                                        „{raw}“
                                    </span>
                                    <select
                                        className={styles.select}
                                        value={statusMapping[raw] ?? ""}
                                        onChange={(event) => {
                                            const value = event.target.value;
                                            setStatusMapping((current) => {
                                                const next = { ...current };
                                                if (value === "") {
                                                    delete next[raw];
                                                } else {
                                                    next[raw] =
                                                        value as ImportStatusMapping[string];
                                                }
                                                return next;
                                            });
                                        }}
                                    >
                                        <option value="">— Standard IDLE —</option>
                                        {VEHICLE_STATUSES.map((status) => (
                                            <option key={status} value={status}>
                                                {vehicleStatusLabel(status)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className={styles.actions}>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setStep("upload")}
                        >
                            Zurück
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={isLoading}
                            onClick={handleMappingNext}
                        >
                            Vorschau
                        </Button>
                    </div>
                </section>
            )}

            {step === "preview" && preview && (
                <section className={styles.panel}>
                    <h2 className={styles.panelTitle}>3. Testlauf</h2>
                    <div className={styles.counts}>
                        <span className={styles.countItem}>
                            Zeilen: <strong>{preview.counts.total_rows}</strong>
                        </span>
                        <span className={styles.countItem}>
                            Neu: <strong>{preview.counts.to_create}</strong>
                        </span>
                        <span className={styles.countItem}>
                            Aktualisieren:{" "}
                            <strong>{preview.counts.to_update}</strong>
                        </span>
                        <span className={styles.countItem}>
                            Überspringen:{" "}
                            <strong>{preview.counts.to_skip}</strong>
                        </span>
                        {preview.counts.errors > 0 && (
                            <span className={styles.countItem}>
                                Fehler:{" "}
                                <strong>{preview.counts.errors}</strong>
                            </span>
                        )}
                    </div>

                    <table className={styles.previewTable}>
                        <thead>
                            <tr>
                                <th>Zeile</th>
                                <th>Kennzeichen</th>
                                <th>Tank</th>
                                <th>Status</th>
                                <th>Fahrer</th>
                                <th>Aktion</th>
                                <th>Hinweise</th>
                            </tr>
                        </thead>
                        <tbody>
                            {preview.rows.map((row) => {
                                const action =
                                    effectiveRowActions[row.row_index] ??
                                    row.default_action;
                                const hasError = row.issues.some(
                                    (issue) => issue.level === "error",
                                );

                                return (
                                    <tr key={row.row_index}>
                                        <td>{row.row_index}</td>
                                        <td>{row.license_plate ?? "—"}</td>
                                        <td>
                                            {row.fuel_level ?? "100 (Standard)"}
                                        </td>
                                        <td>
                                            {row.status
                                                ? vehicleStatusLabel(row.status)
                                                : "IDLE (Standard)"}
                                        </td>
                                        <td>{row.driver_name ?? "—"}</td>
                                        <td>
                                            <select
                                                className={styles.select}
                                                value={action}
                                                disabled={hasError}
                                                onChange={(event) => {
                                                    const value = event.target
                                                        .value as ImportRowAction;
                                                    setRowActions((current) => ({
                                                        ...current,
                                                        [row.row_index]: value,
                                                    }));
                                                }}
                                            >
                                                {IMPORT_ROW_ACTIONS.map(
                                                    (option) => (
                                                        <option
                                                            key={option}
                                                            value={option}
                                                        >
                                                            {
                                                                ROW_ACTION_LABELS[
                                                                    option
                                                                ]
                                                            }
                                                        </option>
                                                    ),
                                                )}
                                            </select>
                                        </td>
                                        <td>
                                            {row.issues.map((issue) => (
                                                <div
                                                    key={`${issue.code}-${issue.message}`}
                                                    className={
                                                        issue.level === "error"
                                                            ? styles.issueError
                                                            : styles.issueWarning
                                                    }
                                                >
                                                    {issue.message}
                                                </div>
                                            ))}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    <div className={styles.actions}>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setStep("mapping")}
                        >
                            Zurück
                        </Button>
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={
                                isLoading ||
                                !preview.rows.some((row) => {
                                    const hasError = row.issues.some(
                                        (issue) => issue.level === "error",
                                    );
                                    const action =
                                        effectiveRowActions[row.row_index];
                                    return (
                                        !hasError &&
                                        (action === "create" ||
                                            action === "update")
                                    );
                                })
                            }
                            onClick={handleCommit}
                        >
                            Import ausführen
                        </Button>
                    </div>
                </section>
            )}

            {step === "result" && commitSummary && (
                <section className={styles.panel}>
                    <h2 className={styles.panelTitle}>4. Ergebnis</h2>
                    <ul className={styles.resultList}>
                        <li>
                            {commitSummary.created_vehicles} Fahrzeuge
                            angelegt
                        </li>
                        <li>
                            {commitSummary.updated_vehicles} Fahrzeuge
                            aktualisiert
                        </li>
                        <li>
                            {commitSummary.created_drivers} Fahrer neu
                            angelegt
                        </li>
                        <li>
                            {commitSummary.skipped_rows} Zeilen übersprungen
                        </li>
                        {commitSummary.failed_rows > 0 && (
                            <li>
                                {commitSummary.failed_rows} Zeilen fehlgeschlagen
                            </li>
                        )}
                    </ul>
                    <div className={styles.actions}>
                        {commitSummary.errors.length > 0 && (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={downloadErrorCsv}
                            >
                                Fehlerliste herunterladen
                            </Button>
                        )}
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => navigate("/vehicles")}
                        >
                            Zur Fahrzeugliste
                        </Button>
                    </div>
                </section>
            )}
        </div>
    );
};
