/**
 * SQLite speichert naive UTC-Zeitstempel ("2026-08-28 06:14:22").
 * Ohne das angehängte "Z" würde der Browser sie als Lokalzeit lesen und
 * die Anzeige läge um den Zeitzonen-Offset daneben.
 */
export const parseSqliteUtc = (value: string): Date | null => {
    const date = new Date(`${value.replace(" ", "T")}Z`);

    return Number.isNaN(date.getTime()) ? null : date;
};

const timeFormat = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
});

const dateTimeFormat = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
});

const isSameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();

/** Heutige Zeitstempel brauchen kein Datum — das ist der Normalfall im Betrieb. */
export const formatTimestamp = (value: string | null): string => {
    if (value === null) {
        return "—";
    }

    const date = parseSqliteUtc(value);

    if (!date) {
        return "—";
    }

    return isSameDay(date, new Date())
        ? timeFormat.format(date)
        : dateTimeFormat.format(date);
};

/** Relative Angabe für den aktuellen Zustand; älter als ein Tag fällt auf die Uhrzeit zurück. */
export const formatRelativeTimestamp = (value: string | null): string => {
    if (value === null) {
        return "—";
    }

    const date = parseSqliteUtc(value);

    if (!date) {
        return "—";
    }

    const diffMs = Date.now() - date.getTime();

    if (diffMs < 0) {
        return formatTimestamp(value);
    }

    const seconds = Math.floor(diffMs / 1000);

    if (seconds < 15) {
        return "gerade eben";
    }

    if (seconds < 60) {
        return `vor ${seconds} s`;
    }

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) {
        return minutes === 1 ? "vor 1 Min." : `vor ${minutes} Min.`;
    }

    const hours = Math.floor(minutes / 60);

    if (hours < 24) {
        return hours === 1 ? "vor 1 Std." : `vor ${hours} Std.`;
    }

    return formatTimestamp(value);
};
