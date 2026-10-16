/** Busy text for the standard submit labels; other labels keep their text. */
export const submitBusyLabel = (label: string): string | undefined =>
    label === "Anlegen"
        ? "Wird angelegt…"
        : label === "Speichern"
          ? "Wird gespeichert…"
          : undefined;
