// src/pages/ImportPage.tsx
import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ChangeEvent,
    type DragEvent,
} from "react";
import { Navigate, useNavigate } from "react-router";
import { createPortal } from "react-dom";
import {
    IMPORT_COLUMN_TARGETS,
    IMPORT_SHEET_KIND_LABELS,
    IMPORT_SHEET_KINDS,
    VEHICLE_STATUSES,
    importRequiredTargets,
    type ImportColumnTarget,
    type ImportPreviewOutcome,
    type ImportPreviewResponse,
    type ImportRowAction,
    type ImportRun,
    type ImportSheetMappings,
    type ImportStatusMapping,
} from "@fleet-live/shared";

import {
    commitImport,
    listImportRuns,
    previewImport,
} from "../api/import";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/Button/Button";
import { Table } from "../components/ui/Table/Table";
import { DetailBackLink } from "../components/navigation/DetailBackLink";
import { ImportPreviewStep } from "../components/vehicles/ImportPreviewStep";
import { useAuth } from "../hooks/useAuth";
import { useVehicles } from "../context/vehiclesContext";
import { vehicleStatusLabel } from "../components/vehicles/vehicleStatus";
import { importRunColumns } from "../components/vehicles/importRunConfig";
import layout from "../styles/detailLayout.module.scss";
import styles from "./ImportPage.module.scss";

type WizardStep = "upload" | "mapping" | "preview" | "result";

const COLUMN_TARGET_LABELS: Record<ImportColumnTarget, string> = {
    license_plate: "Kennzeichen",
    fuel_level: "Tankstand (%)",
    status: "Status",
    driver_name: "Fahrer",
    vin: "VIN",
    vehicle_type: "Fahrzeugtyp",
    hu_due_on: "HU fällig",
    depot: "Standort",
    cost_center: "Kostenstelle",
    phone: "Telefon",
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
const SAMPLE_XLSX_HREF = "/import-beispiel.xlsx";
const TOAST_DURATION_MS = 8000;

function ImportAlert({
    message,
    onClose,
}: {
    message: string;
    onClose: () => void;
}) {
    useEffect(() => {
        const timeoutId = window.setTimeout(onClose, TOAST_DURATION_MS);
        return () => window.clearTimeout(timeoutId);
    }, [message, onClose]);

    return createPortal(
        <div className={styles.toastViewport}>
            <div className={styles.toast} role="alert">
                <div className={styles.toastRow}>
                    <p className={styles.toastMessage}>{message}</p>
                    <Button
                        variant="ghost"
                        size="sm"
                        icon
                        aria-label="Schließen"
                        onClick={onClose}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            width="16"
                            height="16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            aria-hidden="true"
                        >
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                    </Button>
                </div>
                <div className={styles.toastTimer} aria-hidden="true">
                    <span
                        key={message}
                        className={styles.toastTimerBar}
                        style={{ animationDuration: `${TOAST_DURATION_MS}ms` }}
                    />
                </div>
            </div>
        </div>,
        document.body,
    );
}

function ImportLog({ runs }: { runs: ImportRun[] }) {
    return (
        <details className={styles.historyDetails}>
            <summary className={styles.historySummary}>
                Letzte Importe ansehen
                {runs.length > 0 ? (
                    <span className={styles.historyCount}>
                        {runs.length.toLocaleString("de-DE")}
                    </span>
                ) : null}
            </summary>
            <p className={styles.historyNote}>
                Wann, wer, und wie viele Zeilen übernommen wurden.
            </p>
            <Table
                columns={importRunColumns}
                rows={runs}
                getRowKey={(row) => row.id}
                caption="Importprotokoll"
                emptyContent="Noch kein Import in dieser Firma."
                className={styles.tableWrap}
            />
        </details>
    );
}

async function fetchUrlAsBase64(href: string): Promise<string> {
    const response = await fetch(href);
    if (!response.ok) {
        throw new Error("Datei nicht geladen.");
    }
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, "UTF-8");
    });
}

function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result ?? "");
            const comma = result.indexOf(",");
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function isLegacyXlsFile(file: File): boolean {
    const name = file.name.toLowerCase();
    return name.endsWith(".xls") && !name.endsWith(".xlsx");
}

function isSpreadsheetFile(file: File): boolean {
    const name = file.name.toLowerCase();
    return (
        name.endsWith(".xlsx") ||
        file.type ===
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
    const [xlsxBase64, setXlsxBase64] = useState<string | null>(null);
    const [fileName, setFileName] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
    const [outcome, setOutcome] = useState<ImportPreviewOutcome | null>(null);
    const [sheetMappings, setSheetMappings] = useState<ImportSheetMappings>(
        {},
    );
    const [statusMapping, setStatusMapping] = useState<ImportStatusMapping>({});
    const [commitSummary, setCommitSummary] = useState<
        Awaited<ReturnType<typeof commitImport>>["data"] | null
    >(null);
    const [saveProfile, setSaveProfile] = useState(true);
    const [runs, setRuns] = useState<ImportRun[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const dismissError = useCallback(() => {
        setError(null);
    }, []);

    useEffect(() => {
        let cancelled = false;

        void listImportRuns()
            .then((response) => {
                if (!cancelled) {
                    setRuns(response.data);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setRuns([]);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const unmappedStatuses =
        preview?.sheets.find((sheet) => sheet.kind === "vehicles")
            ?.unmapped_status_values ??
        preview?.unmapped_status_values ??
        [];

    const previewSheets = preview?.sheets ?? [];

    if (!canWrite) {
        return <Navigate to="/vehicles" replace />;
    }

    const applyFile = async (file: File) => {
        if (isLegacyXlsFile(file)) {
            setError(
                "Alte .xls-Dateien werden nicht gelesen. Bitte als .xlsx speichern.",
            );
            return;
        }

        if (isSpreadsheetFile(file)) {
            setError(null);
            try {
                const base64 = await readFileAsBase64(file);
                setXlsxBase64(base64);
                setCsvContent("");
                setFileName(file.name);
                setPreview(null);
                setOutcome(null);
                setCommitSummary(null);
                setSheetMappings({});
                setStatusMapping({});
            } catch {
                setError("Die Datei konnte nicht gelesen werden.");
            }
            return;
        }

        if (!isCsvFile(file)) {
            setError("Bitte eine CSV- oder Excel-Datei (.xlsx) auswählen.");
            return;
        }

        setError(null);
        try {
            const text = await readFileAsText(file);
            setCsvContent(text);
            setXlsxBase64(null);
            setFileName(file.name);
            setPreview(null);
            setOutcome(null);
            setCommitSummary(null);
            setSheetMappings({});
            setStatusMapping({});
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

    const loadSampleXlsx = async () => {
        setError(null);
        try {
            const base64 = await fetchUrlAsBase64(SAMPLE_XLSX_HREF);
            setXlsxBase64(base64);
            setCsvContent("");
            setFileName("import-beispiel.xlsx");
            setPreview(null);
            setOutcome(null);
            setCommitSummary(null);
            setSheetMappings({});
            setStatusMapping({});
        } catch {
            setError("Beispieldatei konnte nicht geladen werden.");
        }
    };

    const runPreview = async (
        nextStep: WizardStep,
        mappings = sheetMappings,
        statuses = statusMapping,
        source?: { csv?: string; xlsx?: string },
    ) => {
        const csv = source?.csv ?? csvContent;
        const xlsx = source?.xlsx ?? xlsxBase64;
        if (!csv.trim() && !xlsx) {
            setError("Bitte zuerst eine CSV- oder Excel-Datei auswählen.");
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const hasSheetMappings = IMPORT_SHEET_KINDS.some(
                (kind) =>
                    mappings[kind] &&
                    Object.keys(mappings[kind] ?? {}).length > 0,
            );

            const response = await previewImport({
                ...(xlsx ? { xlsx } : { csv }),
                sheet_mappings: hasSheetMappings ? mappings : undefined,
                column_mapping:
                    mappings.vehicles &&
                    Object.keys(mappings.vehicles).length > 0
                        ? mappings.vehicles
                        : undefined,
                status_mapping:
                    Object.keys(statuses).length > 0 ? statuses : undefined,
            });
            const data = response.data;

            setPreview(data);
            setOutcome(data.outcome);
            setSheetMappings((current) => {
                const next: ImportSheetMappings = { ...current };
                for (const sheet of data.sheets) {
                    const existing = current[sheet.kind];
                    next[sheet.kind] =
                        existing && Object.keys(existing).length > 0
                            ? existing
                            : sheet.suggested_mapping;
                }
                return next;
            });
            setStatusMapping(statuses);
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
        for (const sheet of previewSheets) {
            const mapping = sheetMappings[sheet.kind] ?? {};
            for (const target of importRequiredTargets(sheet.kind)) {
                if (!Object.values(mapping).includes(target)) {
                    setError(
                        `Blatt „${sheet.name}": mindestens eine Spalte muss „${COLUMN_TARGET_LABELS[target]}" sein.`,
                    );
                    return;
                }
            }
        }

        await runPreview("preview", sheetMappings, statusMapping);
    };

    const handleCommit = async (rowActions: Record<string, ImportRowAction>) => {
        if (!preview?.preview_id) {
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await commitImport({
                preview_id: preview.preview_id,
                row_actions: rowActions,
                save_profile: saveProfile,
            });

            setCommitSummary(response.data);
            setStep("result");
            refetchLists();
            try {
                const log = await listImportRuns();
                setRuns(log.data);
            } catch {
                // Ergebnis zählt; das Protokoll ist nachrangig.
            }
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
        setXlsxBase64(null);
        setFileName(null);
        setPreview(null);
        setOutcome(null);
        setSheetMappings({});
        setStatusMapping({});
        setCommitSummary(null);
        setError(null);
    };

    return (
        <section className={`${layout.page} ${styles.page}`}>
            <DetailBackLink fallback="/vehicles" />

            <header>
                <h1 className={styles.title}>Bestand importieren</h1>
                <p className={styles.lead}>
                    Stammdaten und Zuweisungen aus CSV oder Excel laden. Die
                    Spaltenzuordnung merkt sich die Firma. Jeder Lauf landet im
                    Protokoll.
                </p>
                <ol className={styles.steps} aria-label="Importschritte">
                    {STEP_ORDER.map((wizardStep, index) => {
                        const state = stepState(step, wizardStep);
                        const isLast = index === STEP_ORDER.length - 1;

                        return (
                            <li
                                key={wizardStep}
                                className={styles.stepItem}
                                aria-current={
                                    state === "active" ? "step" : undefined
                                }
                            >
                                {state === "done" ? (
                                    <button
                                        type="button"
                                        className={styles.stepDone}
                                        onClick={() => setStep(wizardStep)}
                                    >
                                        <span
                                            className={`${styles.stepBadge} ${styles.stepBadgeDone}`}
                                        >
                                            ✓
                                        </span>
                                        <span className={styles.stepLabel}>
                                            {STEP_LABELS[wizardStep]}
                                        </span>
                                    </button>
                                ) : (
                                    <span
                                        className={
                                            state === "active"
                                                ? styles.stepActive
                                                : styles.step
                                        }
                                    >
                                        <span
                                            className={
                                                state === "active"
                                                    ? `${styles.stepBadge} ${styles.stepBadgeActive}`
                                                    : styles.stepBadge
                                            }
                                        >
                                            {index + 1}
                                        </span>
                                        <span className={styles.stepLabel}>
                                            {STEP_LABELS[wizardStep]}
                                        </span>
                                    </span>
                                )}
                                {!isLast ? (
                                    <span
                                        className={styles.stepConnector}
                                        aria-hidden
                                    />
                                ) : null}
                            </li>
                        );
                    })}
                </ol>
            </header>

            {step === "upload" && (
                <section className={layout.panel}>
                    <h2 className={layout.panelTitle}>Datei wählen</h2>
                    <p className={layout.note}>
                        CSV (nur Fahrzeuge) oder Excel (.xlsx) mit Blättern für
                        Fahrzeuge, Fahrer, Freigaben und Besatzung. Alte
                        .xls-Dateien bitte zuerst als .xlsx speichern.
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
                            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            onChange={handleFileChange}
                        />
                        <svg
                            className={styles.dropIcon}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            aria-hidden
                        >
                            <path d="M12 15V4M7 9l5-5 5 5" />
                            <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                        </svg>
                        <p className={styles.dropTitle}>
                            CSV oder Excel (.xlsx) hierher ziehen oder
                            auswählen
                        </p>
                        <div className={styles.dropActions}>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    fileInputRef.current?.click();
                                }}
                            >
                                Datei auswählen
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                disabled={isLoading}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void loadSampleXlsx();
                                }}
                            >
                                Beispieldatei laden
                            </Button>
                        </div>
                        <p className={styles.fileName}>
                            {fileName ?? "Keine Datei gewählt"}
                        </p>
                    </div>
                    <p className={styles.sampleLinks}>
                        <a
                            className={styles.sampleLink}
                            href={SAMPLE_FILE_HREF}
                            download="import-beispiel.csv"
                        >
                            Beispiel-CSV (nur Fahrzeuge)
                        </a>
                        <a
                            className={styles.sampleLink}
                            href={SAMPLE_XLSX_HREF}
                            download="import-beispiel.xlsx"
                        >
                            Beispiel-Excel (vier Blätter)
                        </a>
                    </p>
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
                            disabled={
                                (!csvContent.trim() && !xlsxBase64) || isLoading
                            }
                            onClick={() => void runPreview("mapping")}
                        >
                            {isLoading ? "Wird gelesen…" : "Weiter"}
                        </Button>
                    </div>
                    <ImportLog runs={runs} />
                </section>
            )}

            {step === "mapping" && preview && (
                <section className={layout.panel}>
                    <h2 className={layout.panelTitle}>Spalten zuordnen</h2>
                    <p className={layout.note}>
                        {previewSheets.length > 1
                            ? `${previewSheets.length} Blätter erkannt. Jede Dateispalte braucht ein Feld, oder „Ignorieren".`
                            : `${preview.columns.length} Spalten erkannt. Jede Dateispalte braucht ein Feld, oder „Ignorieren".`}
                    </p>
                    {preview.profile_applied && (
                        <p className={layout.note}>
                            Firmenprofil angewendet: so sehen eure Exporte aus.
                            Du kannst die Zuordnung noch ändern.
                        </p>
                    )}
                    {previewSheets.map((sheet) => (
                        <div key={sheet.kind} className={styles.sheetBlock}>
                            <h3 className={styles.sheetHeading}>
                                {IMPORT_SHEET_KIND_LABELS[sheet.kind]}
                                {sheet.name !==
                                IMPORT_SHEET_KIND_LABELS[sheet.kind]
                                    ? ` · ${sheet.name}`
                                    : ""}
                            </h3>
                            <div className={styles.mappingGrid}>
                                {sheet.columns.map((column) => (
                                    <label
                                        key={`${sheet.kind}-${column}`}
                                        className={styles.mappingRow}
                                    >
                                        <span className={styles.mappingLabel}>
                                            {column}
                                        </span>
                                        <select
                                            className={styles.select}
                                            value={
                                                sheetMappings[sheet.kind]?.[
                                                    column
                                                ] ?? "ignore"
                                            }
                                            onChange={(event) => {
                                                const value = event.target
                                                    .value as ImportColumnTarget;
                                                setSheetMappings((current) => ({
                                                    ...current,
                                                    [sheet.kind]: {
                                                        ...current[sheet.kind],
                                                        [column]: value,
                                                    },
                                                }));
                                            }}
                                        >
                                            {IMPORT_COLUMN_TARGETS.map(
                                                (target) => (
                                                    <option
                                                        key={target}
                                                        value={target}
                                                    >
                                                        {
                                                            COLUMN_TARGET_LABELS[
                                                                target
                                                            ]
                                                        }
                                                    </option>
                                                ),
                                            )}
                                        </select>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}

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
                                        „{raw}"
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

            {step === "preview" && preview && outcome && (
                <ImportPreviewStep
                    preview={preview}
                    outcome={outcome}
                    saveProfile={saveProfile}
                    isLoading={isLoading}
                    onOutcomeChange={setOutcome}
                    onSaveProfileChange={setSaveProfile}
                    onBack={() => setStep("mapping")}
                    onCommit={(actions) => void handleCommit(actions)}
                    onError={setError}
                />
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
                            <dt>Freigaben</dt>
                            <dd>{commitSummary.assigned_eligibility}</dd>
                        </div>
                        <div>
                            <dt>Besatzung gesetzt</dt>
                            <dd>{commitSummary.set_current}</dd>
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
                        {commitSummary.profile_saved && (
                            <div>
                                <dt>Profil</dt>
                                <dd>gespeichert</dd>
                            </div>
                        )}
                    </dl>
                    {commitSummary.errors.length > 0 && (
                        <div className={styles.problemBanner} role="alert">
                            <p className={styles.problemBannerLead}>
                                {commitSummary.failed_rows === 1
                                    ? "Eine Zeile konnte nicht übernommen werden, der Rest schon:"
                                    : `${commitSummary.failed_rows} Zeilen konnten nicht übernommen werden, der Rest schon:`}
                            </p>
                            <ul className={styles.problemList}>
                                {commitSummary.errors.map((entry) => (
                                    <li
                                        key={`${entry.row_index}-${entry.message}`}
                                    >
                                        {entry.message}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
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
                    <ImportLog runs={runs} />
                </section>
            )}

            {error && (
                <ImportAlert message={error} onClose={dismissError} />
            )}
        </section>
    );
};
