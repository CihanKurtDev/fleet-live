export type PageWindowItem =
    | number
    | "ellipsis-start"
    | "ellipsis-end";

const range = (start: number, end: number): number[] => {
    if (end < start) {
        return [];
    }

    return Array.from(
        { length: end - start + 1 },
        (_, index) => start + index,
    );
};

/**
 * Baut die Seitenliste für die Pagination.
 *
 * Erste und letzte Seite sind immer sichtbar, dazwischen wird ein
 * Fenster um die aktuelle Seite gezeigt. Dadurch bleibt die Leiste
 * auch bei sehr vielen Seiten gleich breit.
 *
 * getPageWindow(10, 20) → [1, "ellipsis-start", 9, 10, 11, "ellipsis-end", 20]
 *
 * @param maxEntries Maximale Anzahl an Einträgen inklusive der Auslassungen.
 */
export const getPageWindow = (
    page: number,
    pageCount: number,
    maxEntries = 7,
): PageWindowItem[] => {
    if (pageCount <= maxEntries) {
        return range(1, pageCount);
    }

    const siblings = Math.max(
        1,
        Math.floor((maxEntries - 5) / 2),
    );

    let left = Math.max(page - siblings, 2);
    let right = Math.min(page + siblings, pageCount - 1);

    // Nahe am Anfang: Fenster nach rechts auffüllen,
    // damit die Leiste ihre Breite behält.
    if (page - siblings <= 2) {
        left = 2;
        right = Math.min(maxEntries - 2, pageCount - 1);
    }

    // Nahe am Ende: Fenster nach links auffüllen.
    if (page + siblings >= pageCount - 1) {
        left = Math.max(pageCount - (maxEntries - 3), 2);
        right = pageCount - 1;
    }

    return [
        1,
        ...(left > 2
            ? (["ellipsis-start"] as PageWindowItem[])
            : []),
        ...range(left, right),
        ...(right < pageCount - 1
            ? (["ellipsis-end"] as PageWindowItem[])
            : []),
        pageCount,
    ];
};
