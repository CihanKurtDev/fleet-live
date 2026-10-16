import { formatCount } from "../../utils/formatCount";

/** "1 Fahrer", "12 Fahrer". */
export const driverCountText = (count: number) =>
    `${formatCount(count)} Fahrer`;

/** The German message of the API, or a plain fallback. */
export const deleteErrorMessage = (reason: unknown): string =>
    reason instanceof Error && reason.message
        ? reason.message
        : "Fahrer konnte nicht gelöscht werden.";

/** Dialog title: singular for one driver, like "Fahrzeug löschen?". */
export const driverDeleteTitle = (count: number): string =>
    count === 1 ? "Fahrer löschen?" : `${driverCountText(count)} löschen?`;
