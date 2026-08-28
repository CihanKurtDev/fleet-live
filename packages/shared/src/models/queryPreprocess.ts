/** Query-string Werte: leer/fehlend → undefined, Arrays → erstes Element. */
export const emptyToUndefined = (value: unknown): unknown => {
    if (value === "" || value === null || value === undefined) {
        return undefined;
    }

    if (Array.isArray(value)) {
        return emptyToUndefined(value[0]);
    }

    return value;
};

/** Suche: fehlend → leerer String, Arrays → erstes Element. */
export const firstQueryString = (value: unknown): unknown =>
    value == null ? "" : Array.isArray(value) ? value[0] : value;
