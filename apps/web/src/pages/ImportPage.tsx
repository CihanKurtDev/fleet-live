import {
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type DragEvent,
} from "react";
import { Navigate, useNavigate } from "react-router";
import {
    IMPORT_COLUMN_TARGETS,
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
import { Table } from "../components/ui/Table/Table";
import { DetailBackLink } from "../components/navigation/DetailBackLink";
import { useAuth } from "../hooks/useAuth";
import { useVehicles } from "../context/vehiclesContext";
import { vehicleStatusLabel } from "../components/vehicles/vehicleStatus";
import {
    importPreviewColumns,
    type ImportPreviewTableRow,
} from "../components/vehicles/importPreviewConfig";
import layout from "../styles/detailLayout.module.scss";
import styles from "./ImportPage.module.scss";

type WizardStep = "upload" | "mapping" | "preview" | "result";

const COLUMN_TARGET_LABELS: Record<ImportColumnTarget, string> = {
    license_plate: "Kennzeichen",
    fuel_level: "Tankstand (%)",
    status: "Status",
    driver_name: "Fahrer",
    ignore: "Ignorieren",
};

const STEP_LABELS: Record<WizardStep, string> = {
    upload: "Datei",
    mapping: "Spalten",
    preview: "Vorschau",
    result: "Ergebnis",
};

const STEP_ORDER: WizardStep[] = ["upload", "mapping", "preview", "result"];

const SAMPLE_FILE_HREF = "/import-beispiel.csv";

function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, "UTF-8");
    });
}

function isSpreadsheetFile(file: File): boolean {
    const name = file.name.toLowerCase();
    return (
        name.endsWith(".xlsx") ||
        name.endsWith(".xls") ||
        file.type ===
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        file.type === "application/vnd.ms-excel"
    );
}

function isCsvFile(file: File): boolean {
    const name = file.name.toLowerCase();
    return (
        name.endsWith(".csv") ||
        file.type === "text/csv" ||
        file.type === "text/plain"
    );
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
    const { refetchLists } = useVehicles();
    const canWrite = user?.role === "dispatcher";

    const [step, setStep] = useState<WizardStep>("upload");
    const [csvContent, setCsvContent] = useState("");
    const [fileName, setFileName] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
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
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    const previewRows = useMemo<ImportPreviewTableRow[]>(() => {
        if (!preview) {
            return [];
        }

        return preview.rows.map((row) => ({
            ...row,
            action: effectiveRowActions[row.row_index] ?? row.default_action,
        }));
    }, [preview, effectiveRowActions]);

    const previewColumns = useMemo(
        () =>
            importPreviewColumns((rowIndex, action) => {
                setRowActions((current) => ({
                    ...current,
                    [rowIndex]: action,
                }));
            }),
        [],
    );

    if (!canWrite) {
        return <Navigate to="/vehicles" replace />;
    }

    const applyFile = async (file: File) => {
        if (isSpreadsheetFile(file)) {
            setError(
                "Excel-Dateien werden noch nicht unterstützt. Bitte als CSV speichern.",
            );
            return;
        }

        if (!isCsvFile(file)) {
            setError("Bitte eine CSV-Datei auswählen.");
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

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            void applyFile(file);
        }
        event.target.value = "";
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) {
            void applyFile(file);
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
            setError(
                "Mindestens eine Spalte muss „Kennzeichen“ zugeordnet werden.",
            );
            return;
        }

        await runPreview("preview", columnMapping, statusMapping);
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
            refetchLists();
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
                (entry) =>
                    `${entry.row_index};${entry.message.replace(/;/g, ",")}`,
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

    const resetWizard = () => {
        setStep("upload");
        setCsvContent("");
        setFileName(null);
        setPreview(null);
        setColumnMapping({});
        setStatusMapping({});
        setRowActions({});
        setCommitSummary(null);
        setError(null);
    };

    const canCommit =
        preview !== null &&
        preview.rows.some((row) => {
            const hasError = row.issues.some(
                (issue) => issue.level === "error",
            );
            const action = effectiveRowActions[row.row_index];
            return !hasError && (action === "create" || action === "update");
        });

    return (
        <section className={`${layout.page} ${styles.page}`}>
            <DetailBackLink fallback="/vehicles" />

            <header>
                <h1 className={styles.title}>Bestand importieren</h1>
                <p className={styles.lead}>
                    Fahrzeuge und optional Fahrer aus einer CSV-Datei laden.
                    Telemetrie, Fahrten und Warnungen bleiben unberührt.
                </p>
                <ol className={styles.steps} aria-label="Importschritte">
                    {STEP_ORDER.map((wizardStep, index) => {
                        const state = stepState(step, wizardStep);

                        if (state === "done") {
                            return (
                                <li key={wizardStep}>
                                    <button
                                        type="button"
                                        className={styles.stepDone}
                                        onClick={() => setStep(wizardStep)}
                                    >
                                        <span className={styles.stepIndex}>
                                            {index + 1}
                                        </span>
                                        {STEP_LABELS[wizardStep]}
                                    </button>
                                </li>
                            );
                        }

                        return (
                            <li
                                key={wizardStep}
                                className={
                                    state === "active"
                                        ? styles.stepActive
                                        : styles.step
                                }
                                aria-current={
                                    state === "active" ? "step" : undefined
                                }
                            >
                                <span className={styles.stepIndex}>
                                    {index + 1}
                                </span>
                                {STEP_LABELS[wizardStep]}
                            </li>
                        );
                    })}
                </ol>
            </header>

            {error && (
                <p className={styles.error} role="alert">
                    {error}
                </p>
            )}

            {step === "upload" && (
                <section className={layout.panel}>
                    <h2 className={layout.panelTitle}>Datei wählen</h2>
                    <p className={layout.note}>
                        Semikolon oder Komma als Trenner. Nur CSV — Excel
                        (.xlsx) wird noch nicht gelesen.
                    </p>
                    <div
                        className={
                            isDragging
                                ? `${styles.dropzone} ${styles.dropzoneActive}`
                                : styles.dropzone
                        }
                        onDragOver={(event) => {
                            event.preventDefault();
                            setIsDragging(true);
                        }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                    >
                        <input
                            ref={fileInputRef}
                            className={styles.fileInput}
                            type="file"
                            accept=".csv,text/csv"
                            onChange={handleFileChange}
                        />
                        <p className={styles.dropTitle}>
                            CSV hierher ziehen oder auswählen
                        </p>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            Datei auswählen
                        </Button>
                        {fileName ? (
                            <p className={styles.fileName}>{fileName}</p>
                        ) : (
                            <p className={layout.note}>Keine Datei gewählt.</p>
                        )}
                    </div>
                    <a
                        className={styles.sampleLink}
                        href={SAMPLE_FILE_HREF}
                        download="import-beispiel.csv"
                    >
                        Beispieldatei herunterladen
                    </a>
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
                            onClick={() => void runPreview("mapping")}
                        >
                            {isLoading ? "Wird gelesen…" : "Weiter"}
                        </Button>
                    </div>
                </section>
            )}

            {step === "mapping" && preview && (
                <section className={layout.panel}>
                    <h2 className={layout.panelTitle}>Spalten zuordnen</h2>
                    <p className={layout.note}>
                        {preview.columns.length} Spalten erkannt. Jede Dateispalte
                        braucht ein Feld — oder „Ignorieren“.
                    </p>
                    <div className={styles.mappingGrid}>
                        {preview.columns.map((column) => (
                            <label key={column} className={styles.mappingRow}>
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
                            </label>
                        ))}
                    </div>

                    {unmappedStatuses.length > 0 && (
                        <div className={styles.statusMapping}>
                            <h3 className={styles.statusHeading}>
                                Statuswerte
                            </h3>
                            <p className={layout.note}>
                                Diese Werte aus der Datei kennt die App nicht.
                                Ohne Zuordnung wird Standby verwendet.
                            </p>
                            {unmappedStatuses.map((raw) => (
                                <label
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
                                        <option value="">
                                            Standby (Standard)
                                        </option>
                                        {VEHICLE_STATUSES.map((status) => (
                                            <option
                                                key={status}
                                                value={status}
                                            >
                                                {vehicleStatusLabel(status)}
                                            </option>
                                        ))}
                                    </select>
                                </label>
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
                            onClick={() => void handleMappingNext()}
                        >
                            {isLoading ? "Wird geprüft…" : "Vorschau"}
                        </Button>
                    </div>
                </section>
            )}

            {step === "preview" && preview && (
                <section className={layout.panel}>
                    <h2 className={layout.panelTitle}>Testlauf</h2>
                    <p className={layout.note}>
                        Bestehende Kennzeichen werden übersprungen, bis du die
                        Aktion auf „Aktualisieren“ stellst.
                    </p>
                    <dl className={layout.facts}>
                        <div>
                            <dt>Zeilen</dt>
                            <dd>{preview.counts.total_rows}</dd>
                        </div>
                        <div>
                            <dt>Neu</dt>
                            <dd>{preview.counts.to_create}</dd>
                        </div>
                        <div>
                            <dt>Aktualisieren</dt>
                            <dd>{preview.counts.to_update}</dd>
                        </div>
                        <div>
                            <dt>Überspringen</dt>
                            <dd>{preview.counts.to_skip}</dd>
                        </div>
                        {preview.counts.errors > 0 && (
                            <div>
                                <dt>Fehler</dt>
                                <dd>{preview.counts.errors}</dd>
                            </div>
                        )}
                    </dl>

                    <Table
                        columns={previewColumns}
                        rows={previewRows}
                        getRowKey={(row) => row.row_index}
                        caption="Importvorschau"
                        isLoading={isLoading}
                        emptyContent="Keine Zeilen in der Datei."
                        className={styles.tableWrap}
                    />

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
                            disabled={isLoading || !canCommit}
                            onClick={() => void handleCommit()}
                        >
                            {isLoading ? "Import läuft…" : "Import ausführen"}
                        </Button>
                    </div>
                </section>
            )}

            {step === "result" && commitSummary && (
                <section className={layout.panel}>
                    <h2 className={layout.panelTitle}>Ergebnis</h2>
                    <dl className={layout.facts}>
                        <div>
                            <dt>Fahrzeuge angelegt</dt>
                            <dd>{commitSummary.created_vehicles}</dd>
                        </div>
                        <div>
                            <dt>Aktualisiert</dt>
                            <dd>{commitSummary.updated_vehicles}</dd>
                        </div>
                        <div>
                            <dt>Fahrer angelegt</dt>
                            <dd>{commitSummary.created_drivers}</dd>
                        </div>
                        <div>
                            <dt>Übersprungen</dt>
                            <dd>{commitSummary.skipped_rows}</dd>
                        </div>
                        {commitSummary.failed_rows > 0 && (
                            <div>
                                <dt>Fehlgeschlagen</dt>
                                <dd>{commitSummary.failed_rows}</dd>
                            </div>
                        )}
                    </dl>
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
                            variant="secondary"
                            size="sm"
                            onClick={resetWizard}
                        >
                            Weitere Datei
                        </Button>
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
        </section>
    );
};
