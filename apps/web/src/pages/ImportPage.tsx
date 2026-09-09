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
    IMPORT_SHEET_KINDS,
    VEHICLE_STATUSES,
    importActionKey,
    importRequiredTargets,
    type ImportColumnTarget,
    type ImportPreviewResponse,
    type ImportRowAction,
    type ImportSheetKind,
    type ImportSheetMappings,
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

const SHEET_KIND_LABELS: Record<ImportSheetKind, string> = {
    vehicles: "Fahrzeuge",
    drivers: "Fahrer",
    eligibility: "Eignung",
    current: "Aktuell",
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
    const [sheetMappings, setSheetMappings] = useState<ImportSheetMappings>(
        {},
    );
    const [statusMapping, setStatusMapping] = useState<ImportStatusMapping>({});
    const [rowActions, setRowActions] = useState<
        Record<string, ImportRowAction>
    >({});
    const [commitSummary, setCommitSummary] = useState<
        Awaited<ReturnType<typeof commitImport>>["data"] | null
    >(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const unmappedStatuses =
        preview?.sheets.find((sheet) => sheet.kind === "vehicles")
            ?.unmapped_status_values ??
        preview?.unmapped_status_values ??
        [];

    const effectiveRowActions = useMemo(() => {
        if (!preview) {
            return {};
        }

        const actions: Record<string, ImportRowAction> = {};
        for (const row of preview.rows) {
            const key = importActionKey(row.sheet_kind, row.row_index);
            actions[key] = rowActions[key] ?? row.default_action;
        }
        return actions;
    }, [preview, rowActions]);

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
                setCommitSummary(null);
                setRowActions({});
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
        mappings = sheetMappings,
        statuses = statusMapping,
    ) => {
        if (!csvContent.trim() && !xlsxBase64) {
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
                ...(xlsxBase64 ? { xlsx: xlsxBase64 } : { csv: csvContent }),
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
        for (const sheet of previewSheets) {
            const mapping = sheetMappings[sheet.kind] ?? {};
            for (const target of importRequiredTargets(sheet.kind)) {
                if (!Object.values(mapping).includes(target)) {
                    setError(
                        `Blatt „${sheet.name}“: mindestens eine Spalte muss „${COLUMN_TARGET_LABELS[target]}“ sein.`,
                    );
                    return;
                }
            }
        }

        await runPreview("preview", sheetMappings, statusMapping);
    };

    const handleCommit = async () => {
        if (!preview?.preview_id) {
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const payload = Object.fromEntries(
                Object.entries(effectiveRowActions),
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
        setXlsxBase64(null);
        setFileName(null);
        setPreview(null);
        setSheetMappings({});
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
            const action =
                effectiveRowActions[
                    importActionKey(row.sheet_kind, row.row_index)
                ];
            return !hasError && (action === "create" || action === "update");
        });

    return (
        <section className={`${layout.page} ${styles.page}`}>
            <DetailBackLink fallback="/vehicles" />

            <header>
                <h1 className={styles.title}>Bestand importieren</h1>
                <p className={styles.lead}>
                    Fahrzeuge, Fahrer, Eignung und aktuelle Zuweisung aus CSV
                    oder Excel laden. Mehrere Excel-Blätter (Fahrzeuge, Fahrer,
                    Eignung, Aktuell) werden erkannt. Telemetrie, Fahrten und
                    Warnungen bleiben unberührt.
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
                        CSV (ein Blatt, Fahrzeuge) oder Excel (.xlsx) mit
                        benannten Blättern: Fahrzeuge, Fahrer, Eignung, Aktuell.
                        Ohne passende Namen gilt das erste Blatt als Fahrzeuge.
                        Alte .xls-Dateien bitte zuerst als .xlsx speichern.
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
                        <p className={styles.dropTitle}>
                            CSV oder Excel (.xlsx) hierher ziehen oder
                            auswählen
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
                            href="/import-beispiel.xlsx"
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
                </section>
            )}

            {step === "mapping" && preview && (
                <section className={layout.panel}>
                    <h2 className={layout.panelTitle}>Spalten zuordnen</h2>
                    <p className={layout.note}>
                        {previewSheets.length > 1
                            ? `${previewSheets.length} Blätter erkannt. Jede Dateispalte braucht ein Feld — oder „Ignorieren“.`
                            : `${preview.columns.length} Spalten erkannt. Jede Dateispalte braucht ein Feld — oder „Ignorieren“.`}
                    </p>
                    {previewSheets.map((sheet) => (
                        <div key={sheet.kind} className={styles.sheetBlock}>
                            <h3 className={styles.sheetHeading}>
                                {SHEET_KIND_LABELS[sheet.kind]}
                                {sheet.name !== SHEET_KIND_LABELS[sheet.kind]
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
                        Bestehende Kennzeichen und Fahrernamen werden
                        übersprungen, bis du die Aktion auf „Aktualisieren“
                        stellst. Eignung und aktuelles Fahrzeug gelten zusätzlich.
                    </p>
                    <dl className={layout.facts}>
                        <div>
                            <dt>Zeilen</dt>
                            <dd>{preview.counts.total_rows}</dd>
                        </div>
                        <div>
                            <dt>Neu / zuweisen</dt>
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

                    {previewSheets.map((sheet) => {
                        const rows: ImportPreviewTableRow[] = sheet.rows.map(
                            (row) => ({
                                ...row,
                                action:
                                    effectiveRowActions[
                                        importActionKey(
                                            row.sheet_kind,
                                            row.row_index,
                                        )
                                    ] ?? row.default_action,
                            }),
                        );

                        return (
                            <div key={sheet.kind} className={styles.sheetBlock}>
                                <h3 className={styles.sheetHeading}>
                                    {SHEET_KIND_LABELS[sheet.kind]}
                                    {` · ${sheet.counts.total_rows} Zeilen`}
                                </h3>
                                <Table
                                    columns={importPreviewColumns(
                                        sheet.kind,
                                        (row, action) => {
                                            setRowActions((current) => ({
                                                ...current,
                                                [importActionKey(
                                                    row.sheet_kind,
                                                    row.row_index,
                                                )]: action,
                                            }));
                                        },
                                    )}
                                    rows={rows}
                                    getRowKey={(row) =>
                                        importActionKey(
                                            row.sheet_kind,
                                            row.row_index,
                                        )
                                    }
                                    caption={`Vorschau ${SHEET_KIND_LABELS[sheet.kind]}`}
                                    isLoading={isLoading}
                                    emptyContent="Keine Zeilen in diesem Blatt."
                                    className={styles.tableWrap}
                                />
                            </div>
                        );
                    })}

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
                            <dt>Eignung</dt>
                            <dd>{commitSummary.assigned_eligibility}</dd>
                        </div>
                        <div>
                            <dt>Aktuell gesetzt</dt>
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
