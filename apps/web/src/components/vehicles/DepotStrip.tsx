import type { Site } from "@fleet-live/shared";

import { formatCount } from "../../utils/formatCount";
import { RetryMessage } from "../ui/RetryMessage";
import { SwapLabel } from "../ui/Button/SwapLabel";
import styles from "./DepotStrip.module.scss";

type DepotStripProps = {
    sites: Site[];
    selectedId: number | null;
    canEdit: boolean;
    placing: boolean;
    /** Ein Entwurf ist offen: anderes Depot erst nach Speichern/Abbrechen. */
    editing: boolean;
    loadError: string | null;
    onRetry: () => void;
    onSelect: (site: Site) => void;
    onStartPlace: () => void;
};

/** Depots unter der Karte: wer gerade im Kreis steht, wer dort zu Hause ist. */
export const DepotStrip = ({
    sites,
    selectedId,
    canEdit,
    placing,
    editing,
    loadError,
    onRetry,
    onSelect,
    onStartPlace,
}: DepotStripProps) => (
    <section className={styles.strip} aria-label="Depots">
        <span className={styles.label}>Depots</span>
        {loadError ? (
            <RetryMessage message={loadError} onRetry={onRetry} />
        ) : sites.length === 0 ? (
            <p className={styles.empty}>Keine Depots angelegt.</p>
        ) : (
            <ul className={styles.list}>
                {sites.map((site) => (
                    <li key={site.id}>
                        <button
                            type="button"
                            className={styles.site}
                            aria-pressed={site.id === selectedId}
                            onClick={() => onSelect(site)}
                        >
                            <span className={styles.name}>{site.name}</span>
                            <span className={styles.counts}>
                                {formatCount(site.in_depot_count)} im Depot ·{" "}
                                {formatCount(site.home_count)} Stammstandort
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        )}
        {canEdit && !editing && (
            <button
                type="button"
                className={styles.add}
                aria-pressed={placing}
                onClick={onStartPlace}
            >
                <SwapLabel swapped={placing} alt="Klicken abbrechen">
                    Depot anlegen
                </SwapLabel>
            </button>
        )}
    </section>
);
