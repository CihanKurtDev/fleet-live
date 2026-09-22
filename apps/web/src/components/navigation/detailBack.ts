export const readBackTarget = (
    state: unknown,
    fallback: string,
): { from: string; fromHistory: boolean } => {
    if (
        typeof state === "object" &&
        state !== null &&
        "from" in state &&
        typeof state.from === "string"
    ) {
        return { from: state.from, fromHistory: true };
    }

    return { from: fallback, fromHistory: false };
};

export const backLabel = (from: string): string => {
    if (from.startsWith("/fleet")) {
        return "Zurück zur Karte";
    }

    if (from.startsWith("/alerts")) {
        return "Zurück zu den Warnungen";
    }

    return "Zurück zur Übersicht";
};
