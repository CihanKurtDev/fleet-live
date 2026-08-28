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
