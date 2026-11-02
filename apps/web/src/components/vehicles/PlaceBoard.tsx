import type { GeoBBox, Site, WorkshopPlace } from "@fleet-live/shared";

import { formatCount } from "../../utils/formatCount";
import { MenuButton } from "../ui/Menu/MenuButton";
import { RetryMessage } from "../ui/RetryMessage";
import { SwapLabel } from "../ui/Button/SwapLabel";
import {
    boardPlaces,
    byActivity,
    insideBox,
    samePlace,
    workshopLine,
    type BoardPlace,
    type PlaceRef,
} from "./places";
import styles from "./PlaceBoard.module.scss";

type PlaceBoardProps = {
    sites: Site[];
    workshops: WorkshopPlace[];
    /** The map's view; the band lists the places in it. */
    view: GeoBBox | null;
    selected: PlaceRef | null;
    canEdit: boolean;
    /** Depot placement is running: „+ Neuer Ort“ cancels it. */
    placing: boolean;
    loadError: string | null;
    onRetry: () => void;
    onSelect: (place: PlaceRef) => void;
    onOpenList: () => void;
    onNewDepot: () => void;
    onNewWorkshop: () => void;
};

const Wrench = () => (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />
    </svg>
);

/** The four status shares of a depot's vehicles, in the colours of the map dots. */
export const StatusBar = ({ site }: { site: Site }) => {
    const { driving, idle, stopped, offline } = site.home_status;
    const total = driving + idle + stopped + offline;
    if (total === 0) {
        return <span className={styles.bar} data-empty="true" aria-hidden="true" />;
    }

    return (
        <span className={styles.bar} aria-hidden="true">
            {(
                [
                    ["driving", driving],
                    ["idle", idle],
                    ["stopped", stopped],
                    ["offline", offline],
                ] as const
            ).map(([status, count]) =>
                count > 0 ? (
                    <span key={status} data-status={status} style={{ flexGrow: count }} />
                ) : null,
            )}
        </span>
    );
};

const Tile = ({ place, pressed, onSelect }: { place: BoardPlace; pressed: boolean; onSelect: () => void }) => {
    if (place.kind === "depot") {
        const { site } = place;
        return (
            <button type="button" className={styles.tile} aria-pressed={pressed} onClick={onSelect}>
                <span className={styles.head}>
                    <span className={styles.name}>{site.name}</span>
                    <span className={styles.figure}>{formatCount(site.home_count)}</span>
                </span>
                <StatusBar site={site} />
                <span className={styles.line}>
                    {formatCount(site.home_status.idle)} Standby · {formatCount(site.in_depot_count)} im Depot
                </span>
            </button>
        );
    }

    const { here, appointment } = workshopLine(place.workshop);
    return (
        <button type="button" className={styles.tile} aria-pressed={pressed} onClick={onSelect}>
            <span className={styles.head}>
                <span className={styles.name}>{place.workshop.name}</span>
                <span className={styles.kind}>
                    <Wrench /> Werkstatt
                </span>
            </span>
            <span className={styles.line}>{here}</span>
            {appointment && <span className={styles.line}>{appointment}</span>}
        </button>
    );
};

/**
 * Under the fleet map: the places of the company in the current view, busy
 * ones first, so each answers its question (how many are at home and ready,
 * who stands in the workshop or has an appointment). „N Orte“ opens the list
 * of all of them; places outside the view are counted at the end.
 */
export const PlaceBoard = ({
    sites,
    workshops,
    view,
    selected,
    canEdit,
    placing,
    loadError,
    onRetry,
    onSelect,
    onOpenList,
    onNewDepot,
    onNewWorkshop,
}: PlaceBoardProps) => {
    const all = boardPlaces(sites, workshops);
    const shown = all
        .filter((place) => insideBox(place, view) || samePlace(selected, place))
        .sort(byActivity);
    const outside = all.length - shown.length;

    return (
        <section className={styles.board} aria-label="Orte" data-many={shown.length > 3 || undefined}>
            <button type="button" className={styles.count} onClick={onOpenList} disabled={all.length === 0}>
                <span className={styles.countFigure}>{formatCount(all.length)}</span>
                <span>{all.length === 1 ? "Ort" : "Orte"}</span>
            </button>
            {loadError ? (
                <RetryMessage message={loadError} onRetry={onRetry} />
            ) : all.length === 0 ? (
                <p className={styles.empty}>
                    {canEdit
                        ? "Noch keine Depots und Werkstätten. „Neuer Ort“ legt den ersten an."
                        : "Noch keine Depots und Werkstätten angelegt."}
                </p>
            ) : (
                <ul className={styles.list}>
                    {shown.map((place) => (
                        <li key={`${place.kind}-${place.id}`}>
                            <Tile
                                place={place}
                                pressed={samePlace(selected, place)}
                                onSelect={() => onSelect({ kind: place.kind, id: place.id })}
                            />
                        </li>
                    ))}
                    {shown.length === 0 && <li className={styles.none}>Kein Ort im Kartenausschnitt.</li>}
                    {outside > 0 && (
                        <li>
                            <button type="button" className={styles.outside} onClick={onOpenList}>
                                + {formatCount(outside)} außerhalb
                            </button>
                        </li>
                    )}
                </ul>
            )}
            {canEdit && (
                <MenuButton
                    label={
                        <SwapLabel swapped={placing} alt="Klicken abbrechen">
                            + Neuer Ort
                        </SwapLabel>
                    }
                    menuLabel="Neuer Ort"
                    caret={false}
                    align="end"
                    size="toolbar"
                    items={[
                        { key: "depot", label: placing ? "Depot: Klicken abbrechen" : "Depot", onSelect: onNewDepot },
                        { key: "workshop", label: "Werkstatt", onSelect: onNewWorkshop },
                    ]}
                />
            )}
        </section>
    );
};
