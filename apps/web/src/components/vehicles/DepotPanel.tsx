import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import {
    DEPOT_RADIUS_MAX_M,
    DEPOT_RADIUS_MIN_M,
    DEPOT_RADIUS_WARN_M,
    type Site,
} from "@fleet-live/shared";
import { Input } from "../ui/Input/Input";
import { RetryMessage } from "../ui/RetryMessage";
import { isDepotDraftDirty, type DepotDraft } from "./depotDraft";
import styles from "./DepotPanel.module.scss";

interface DepotPanelProps {
    sites: Site[];
    selectedId: number | null;
    draft: DepotDraft | null;
    placing: boolean;
    canEdit: boolean;
    saveError: string | null;
    loadError: string | null;
    isSaving: boolean;
    /** Steigt, wenn ein Depot von der Karte oder der Liste gewählt wird. */
    revealToken: number;
    onSelect: (site: Site) => void;
    onEdit: (site: Site) => void;
    onStartPlace: () => void;
    onCancel: () => void;
    onDraftChange: (draft: DepotDraft) => void;
    onSave: () => void;
    onAskDelete: (site: Site) => void;
    onRetryLoad: () => void;
}

const Icon = ({ children }: { children: ReactNode }) => (
    <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        {children}
    </svg>
);

const PencilIcon = () => (
    <Icon>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
);

const TrashIcon = () => (
    <Icon>
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M19 6l-1 14H6L5 6" />
    </Icon>
);

const CloseIcon = () => (
    <Icon>
        <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
);

const CheckIcon = () => (
    <Icon>
        <path d="M20 6 9 17l-5-5" />
    </Icon>
);

export const DepotPanel = ({
    sites,
    selectedId,
    draft,
    placing,
    canEdit,
    saveError,
    loadError,
    isSaving,
    revealToken,
    onSelect,
    onEdit,
    onStartPlace,
    onCancel,
    onDraftChange,
    onSave,
    onAskDelete,
    onRetryLoad,
}: DepotPanelProps) => {
    const detailsRef = useRef<HTMLDetailsElement>(null);
    const selected = sites.find((site) => site.id === selectedId) ?? null;
    const dirty = draft !== null && isDepotDraftDirty(draft, sites);
    const radiusTooWide =
        draft !== null && draft.radius_m >= DEPOT_RADIUS_WARN_M;
    const editingSaved = draft !== null && draft.id !== "new";

    useEffect(() => {
        if (detailsRef.current && (draft || placing)) {
            detailsRef.current.open = true;
        }
    }, [draft, placing]);

    useEffect(() => {
        if (revealToken > 0 && detailsRef.current) {
            detailsRef.current.open = true;
        }
    }, [revealToken]);

    return (
        <details id="depots" ref={detailsRef} className={styles.panel}>
            <summary>Depots ({sites.length})</summary>
            {loadError && (
                <div className={styles.loadError}>
                    <RetryMessage message={loadError} onRetry={onRetryLoad} />
                </div>
            )}
            {sites.length === 0 && draft === null && !loadError && (
                <>
                    <p className={styles.empty}>Keine Depots angelegt.</p>
                    {canEdit && (
                        <p className={styles.hint}>
                            Der Kreis ist nur die Fläche. Stammstandort setzt
                            du danach am{" "}
                            <Link to="/vehicles">Fahrzeug</Link> oder per{" "}
                            <Link to="/vehicles/import">Import</Link>.
                        </p>
                    )}
                </>
            )}
            {sites.length > 0 && (
                <ul className={styles.list}>
                    {sites.map((site) => {
                        const isSelected = site.id === selectedId;
                        const showViewIcons =
                            canEdit &&
                            isSelected &&
                            !(editingSaved && dirty && draft?.id === site.id);

                        return (
                            <li
                                key={site.id}
                                className={
                                    isSelected ? styles.itemSelected : styles.item
                                }
                            >
                                <div className={styles.head}>
                                    <button
                                        type="button"
                                        className={styles.nameButton}
                                        aria-pressed={isSelected}
                                        disabled={dirty}
                                        onClick={() => onSelect(site)}
                                    >
                                        {site.name}
                                    </button>
                                    {showViewIcons && (
                                        <div className={styles.icons}>
                                            {draft?.id !== site.id && (
                                                <button
                                                    type="button"
                                                    className={styles.iconButton}
                                                    aria-label={`${site.name} bearbeiten`}
                                                    onClick={() => onEdit(site)}
                                                >
                                                    <PencilIcon />
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                className={`${styles.iconButton} ${styles.iconDanger}`}
                                                aria-label={`${site.name} löschen`}
                                                onClick={() => onAskDelete(site)}
                                            >
                                                <TrashIcon />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    className={styles.statsButton}
                                    disabled={dirty}
                                    onClick={() => onSelect(site)}
                                >
                                    <span className={styles.stat}>
                                        <span>Stammstandort</span>
                                        <span className={styles.statValue}>
                                            {site.home_count}
                                        </span>
                                    </span>
                                    <span className={styles.stat}>
                                        <span>Im Depot</span>
                                        <span className={styles.statValue}>
                                            {site.in_depot_count}
                                        </span>
                                    </span>
                                    {site.other_home_count > 0 && (
                                        <span className={styles.note}>
                                            davon {site.other_home_count} mit
                                            anderem Stammstandort
                                        </span>
                                    )}
                                </button>
                                {isSelected &&
                                    canEdit &&
                                    site.home_count === 0 && (
                                        <p className={styles.assign}>
                                            Stammstandort setzt du am{" "}
                                            <Link to="/vehicles">
                                                Fahrzeug
                                            </Link>{" "}
                                            oder per{" "}
                                            <Link to="/vehicles/import">
                                                Import
                                            </Link>
                                            . „Im Depot“ kommt von der Position
                                            im Kreis.
                                        </p>
                                    )}
                                {isSelected && site.home_count > 0 && (
                                    <p className={styles.assign}>
                                        <Link
                                            to={`/vehicles?search=${encodeURIComponent(site.name)}`}
                                        >
                                            {site.home_count === 1
                                                ? "1 Fahrzeug in der Liste"
                                                : `${site.home_count} Fahrzeuge in der Liste`}
                                        </Link>
                                    </p>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
            {canEdit && draft === null && (
                <button
                    type="button"
                    className={styles.add}
                    disabled={dirty}
                    onClick={onStartPlace}
                >
                    {placing ? "Klicken abbrechen" : "Depot anlegen"}
                </button>
            )}
            {placing && draft === null && (
                <p className={styles.hint}>
                    Klicke in die Karte, um den Mittelpunkt zu setzen.
                </p>
            )}
            {canEdit && draft && (
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
                        value={draft.name}
                        onChange={(event) =>
                            onDraftChange({
                                ...draft,
                                name: event.target.value,
                            })
                        }
                    />
                    <label htmlFor="depot-radius">
                        Radius {draft.radius_m} m
                    </label>
                    <Input
                        id="depot-radius"
                        className={styles.slider}
                        type="range"
                        min={DEPOT_RADIUS_MIN_M}
                        max={DEPOT_RADIUS_MAX_M}
                        step={50}
                        value={draft.radius_m}
                        onChange={(event) =>
                            onDraftChange({
                                ...draft,
                                radius_m: Number(event.target.value),
                            })
                        }
                    />
                    {radiusTooWide && (
                        <p className={styles.warn} role="status">
                            Der Kreis ist so groß, dass ein großer Teil der
                            Stadt als Depot zählt.
                        </p>
                    )}
                    <p className={styles.hint}>
                        Ziehe den Punkt in der Mitte, um das Depot zu
                        verschieben.
                    </p>
                    {dirty && (
                        <p className={styles.hint}>
                            Speichern oder abbrechen, um ein anderes Depot zu
                            wählen.
                        </p>
                    )}
                    {saveError && (
                        <p className={styles.error} role="alert">
                            {saveError}
                        </p>
                    )}
                    {dirty && (
                        <div className={styles.actions}>
                            <button
                                type="button"
                                className={styles.action}
                                onClick={onCancel}
                                disabled={isSaving}
                            >
                                <CloseIcon />
                                Abbrechen
                            </button>
                            <button
                                type="submit"
                                className={`${styles.action} ${styles.actionPrimary}`}
                                disabled={
                                    isSaving || draft.name.trim().length === 0
                                }
                            >
                                <CheckIcon />
                                Speichern
                            </button>
                            {selected && draft.id === selected.id && (
                                <button
                                    type="button"
                                    className={`${styles.iconButton} ${styles.iconDanger} ${styles.actionDelete}`}
                                    aria-label={`${selected.name} löschen`}
                                    onClick={() => onAskDelete(selected)}
                                    disabled={isSaving}
                                >
                                    <TrashIcon />
                                </button>
                            )}
                        </div>
                    )}
                </form>
            )}
        </details>
    );
};
