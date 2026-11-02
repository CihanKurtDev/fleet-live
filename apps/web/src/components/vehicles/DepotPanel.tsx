import { Link } from "react-router";
import {
    DEPOT_RADIUS_MAX_M,
    DEPOT_RADIUS_MIN_M,
    DEPOT_RADIUS_WARN_M,
    VEHICLE_STATUS_LABELS,
    type Site,
} from "@fleet-live/shared";

import { formatCount } from "../../utils/formatCount";
import { Button } from "../ui/Button/Button";
import { Input } from "../ui/Input/Input";
import { RetryMessage } from "../ui/RetryMessage";
import { isDepotDraftDirty, type DepotDraft } from "./depotDraft";
import { StatusBar } from "./PlaceBoard";
import styles from "./PlaceCard.module.scss";

interface DepotPanelProps {
    sites: Site[];
    selectedId: number | null;
    draft: DepotDraft | null;
    placing: boolean;
    canEdit: boolean;
    saveError: string | null;
    loadError: string | null;
    isSaving: boolean;
    /** Clears the selection: card, highlight and URL. */
    onDeselect: () => void;
    onEdit: (site: Site) => void;
    onCancel: () => void;
    onDraftChange: (draft: DepotDraft) => void;
    onSave: () => void;
    onAskDelete: (site: Site) => void;
    onRetryLoad: () => void;
}

const STATUS_ROWS = [
    ["driving", "DRIVING"],
    ["idle", "IDLE"],
    ["stopped", "STOPPED"],
    ["offline", "OFFLINE"],
] as const;

/**
 * The depot picked on the fleet map, as a card over it: how many vehicles are
 * at home there and in which state, how many stand in the circle now. A
 * dispatcher edits it in the same card (name, radius, the point dragged on
 * the map) or places a new one.
 */
export const DepotPanel = ({
    sites,
    selectedId,
    draft,
    placing,
    canEdit,
    saveError,
    loadError,
    isSaving,
    onDeselect,
    onEdit,
    onCancel,
    onDraftChange,
    onSave,
    onAskDelete,
    onRetryLoad,
}: DepotPanelProps) => {
    const selected = sites.find((site) => site.id === selectedId) ?? null;
    const dirty = draft !== null && isDepotDraftDirty(draft, sites);

    if (canEdit && draft) {
        const editingSaved = draft.id !== "new";
        return (
            <section className={styles.card} aria-label={editingSaved ? "Depot bearbeiten" : "Depot anlegen"}>
                <div className={styles.cardHead}>
                    <span className={styles.kindTag}>Depot</span>
                    <h2 className={styles.title}>{editingSaved ? "Bearbeiten" : "Neues Depot"}</h2>
                </div>
                <form
                    className={styles.editor}
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (dirty) {
                            onSave();
                        }
                    }}
                >
                    <label htmlFor="depot-name">Name</label>
                    <Input
                        id="depot-name"
                        size="sm"
                        fullWidth
                        autoFocus
                        value={draft.name}
                        onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
                    />
                    <label htmlFor="depot-radius">Kreis: {draft.radius_m} m</label>
                    <Input
                        id="depot-radius"
                        type="range"
                        min={DEPOT_RADIUS_MIN_M}
                        max={DEPOT_RADIUS_MAX_M}
                        step={50}
                        value={draft.radius_m}
                        onChange={(event) => onDraftChange({ ...draft, radius_m: Number(event.target.value) })}
                    />
                    {draft.radius_m >= DEPOT_RADIUS_WARN_M && (
                        <p className={styles.warn} role="status">
                            Der Kreis ist so groß, dass ein großer Teil der Stadt als Depot zählt.
                        </p>
                    )}
                    <p className={styles.muted}>Den Punkt in der Mitte auf der Karte ziehen, um das Depot zu verschieben.</p>
                    {saveError && (
                        <p className={styles.error} role="alert">
                            {saveError}
                        </p>
                    )}
                    <div className={styles.cardActions}>
                        {editingSaved && selected && (
                            <Button
                                type="button"
                                variant="dangerOutline"
                                size="sm"
                                className={styles.actionsStart}
                                disabled={isSaving}
                                onClick={() => onAskDelete(selected)}
                            >
                                Löschen
                            </Button>
                        )}
                        <Button type="button" variant="secondary" size="sm" disabled={isSaving} onClick={onCancel}>
                            Abbrechen
                        </Button>
                        <Button
                            type="submit"
                            size="sm"
                            busy={isSaving}
                            busyLabel="Speichert…"
                            disabled={!dirty || draft.name.trim().length === 0}
                        >
                            Speichern
                        </Button>
                    </div>
                </form>
            </section>
        );
    }

    if (placing) {
        return (
            <section className={styles.card} aria-label="Depot anlegen">
                <div className={styles.cardHead}>
                    <span className={styles.kindTag}>Depot</span>
                    <h2 className={styles.title}>Neues Depot</h2>
                </div>
                <p className={styles.muted}>Klicke in die Karte, wo das Depot liegt.</p>
                {saveError && (
                    <p className={styles.error} role="alert">
                        {saveError}
                    </p>
                )}
                <div className={styles.cardActions}>
                    <Button variant="secondary" size="sm" onClick={onCancel}>
                        Abbrechen
                    </Button>
                </div>
            </section>
        );
    }

    if (!selected) {
        return loadError ? (
            <section className={styles.card} aria-label="Depots">
                <RetryMessage message={loadError} onRetry={onRetryLoad} />
            </section>
        ) : saveError ? (
            <section className={styles.card} aria-label="Depot">
                <p className={styles.error} role="alert">
                    {saveError}
                </p>
            </section>
        ) : null;
    }

    return (
        <section className={styles.card} aria-label={`Depot ${selected.name}`}>
            <div className={styles.cardHead}>
                <span className={styles.kindTag}>Depot</span>
                <h2 className={styles.title}>{selected.name}</h2>
                <button type="button" className={styles.close} aria-label="Auswahl aufheben" onClick={onDeselect}>
                    ✕
                </button>
            </div>
            <p className={styles.lead}>
                Stammstandort von{" "}
                <b>
                    {selected.home_count === 1 ? "1 Fahrzeug" : `${formatCount(selected.home_count)} Fahrzeugen`}
                </b>
            </p>
            {selected.home_count > 0 && (
                <>
                    <StatusBar site={selected} />
                    <ul className={styles.legend}>
                        {STATUS_ROWS.map(([key, status]) => (
                            <li key={key}>
                                <span className={styles.dot} data-status={key} aria-hidden="true" />
                                {VEHICLE_STATUS_LABELS[status]}
                                <b>{formatCount(selected.home_status[key])}</b>
                            </li>
                        ))}
                    </ul>
                </>
            )}
            <p className={styles.lead}>
                Jetzt im Depot: <b>{formatCount(selected.in_depot_count)}</b>
                {selected.other_home_count > 0 && (
                    <span className={styles.muted}> · davon {formatCount(selected.other_home_count)} von anderswo</span>
                )}
            </p>
            {selected.home_count > 0 ? (
                <Link className={styles.link} to={`/vehicles?search=${encodeURIComponent(selected.name)}`}>
                    {selected.home_count === 1 ? "1 Fahrzeug in der Liste" : `${formatCount(selected.home_count)} Fahrzeuge in der Liste`}
                </Link>
            ) : (
                canEdit && (
                    <p className={styles.muted}>
                        Stammstandort setzt du am <Link to="/vehicles">Fahrzeug</Link> oder per{" "}
                        <Link to="/vehicles/import">Import</Link>. „Im Depot“ kommt von der Position im Kreis.
                    </p>
                )
            )}
            {saveError && (
                <p className={styles.error} role="alert">
                    {saveError}
                </p>
            )}
            {canEdit && (
                <div className={styles.cardActions}>
                    <Button variant="secondary" size="sm" onClick={() => onEdit(selected)}>
                        Bearbeiten
                    </Button>
                </div>
            )}
        </section>
    );
};
