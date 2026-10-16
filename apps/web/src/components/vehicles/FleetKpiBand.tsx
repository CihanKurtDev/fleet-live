import {
    KpiTiles,
    type KpiTile,
    type KpiTileTone,
} from "../ui/KpiTiles/KpiTiles";

export type FleetKpiTone = KpiTileTone;
export type FleetKpiTile = KpiTile;

type FleetKpiBandProps = {
    tiles: FleetKpiTile[];
};

/** Lagezahlen über der Karte. Jede Kachel schaltet den passenden Kartenfilter. */
export const FleetKpiBand = ({ tiles }: FleetKpiBandProps) => (
    <KpiTiles tiles={tiles} ariaLabel="Lage" />
);
