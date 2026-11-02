import { useState } from "react";
import type { Site, WorkshopPlace } from "@fleet-live/shared";

import { formatCount } from "../../utils/formatCount";
import { Input } from "../ui/Input/Input";
import { boardPlaces, samePlace, workshopLine, type BoardPlace, type PlaceRef } from "./places";
import styles from "./PlaceCard.module.scss";

type PlaceListProps = {
    sites: Site[];
    workshops: WorkshopPlace[];
    selected: PlaceRef | null;
    onSelect: (place: PlaceRef) => void;
    onClose: () => void;
};

const figure = (place: BoardPlace) => {
    if (place.kind === "depot") {
        return {
            value: formatCount(place.site.home_count),
            line: `${formatCount(place.site.home_status.idle)} Standby · ${formatCount(place.site.in_depot_count)} im Depot`,
        };
    }
    const { here, appointment } = workshopLine(place.workshop);
    return { value: null, line: appointment ? `${here} · ${appointment}` : here };
};

/** All places of the company, searchable, depots and workshops apart; a row flies there. */
export const PlaceList = ({ sites, workshops, selected, onSelect, onClose }: PlaceListProps) => {
    const [search, setSearch] = useState("");
    const needle = search.trim().toLocaleLowerCase("de");
    const all = boardPlaces(sites, workshops).filter(
        (place) =>
            needle === "" ||
            place.name.toLocaleLowerCase("de").includes(needle) ||
            (place.kind === "workshop" && (place.workshop.address ?? "").toLocaleLowerCase("de").includes(needle)),
    );
    const groups = [
        { title: "Depots", rows: all.filter((place) => place.kind === "depot"), total: sites.length },
        { title: "Werkstätten", rows: all.filter((place) => place.kind === "workshop"), total: workshops.length },
    ];

    return (
        <section className={styles.card} aria-label="Alle Orte">
            <div className={styles.cardHead}>
                <h2 className={styles.title}>Alle Orte</h2>
                <span className={styles.muted}>{formatCount(sites.length + workshops.length)} Orte</span>
                <button type="button" className={styles.close} aria-label="Liste schließen" onClick={onClose}>
                    ✕
                </button>
            </div>
            <div className={styles.search}>
                <Input
                    size="sm"
                    fullWidth
                    type="search"
                    placeholder="Ort suchen"
                    aria-label="Ort suchen"
                    data-autofocus
                    autoFocus
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />
            </div>
            <div className={styles.scroll}>
                {groups.map((group) =>
                    group.total === 0 ? null : (
                        <div key={group.title}>
                            <p className={styles.group}>
                                {group.title} · {formatCount(group.rows.length)}
                            </p>
                            {group.rows.length === 0 ? (
                                <p className={styles.muted}>Kein Treffer.</p>
                            ) : (
                                <ul className={styles.rows}>
                                    {group.rows.map((place) => {
                                        const { value, line } = figure(place);
                                        return (
                                            <li key={`${place.kind}-${place.id}`}>
                                                <button
                                                    type="button"
                                                    className={styles.row}
                                                    aria-pressed={samePlace(selected, place)}
                                                    onClick={() => onSelect({ kind: place.kind, id: place.id })}
                                                >
                                                    <span className={styles.rowHead}>
                                                        <span className={styles.rowName}>{place.name}</span>
                                                        {value && <span className={styles.rowFigure}>{value}</span>}
                                                    </span>
                                                    <span className={styles.rowLine}>{line}</span>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    ),
                )}
            </div>
            <p className={styles.foot}>Klick auf einen Ort: die Karte fährt hin.</p>
        </section>
    );
};
