import {
    DRIVER_TALK_MIN_OPEN_WARNINGS,
    type UserRole,
} from "@fleet-live/shared";

export type TipPageId =
    | "briefing"
    | "fristen"
    | "vehicles"
    | "alerts"
    | "drivers"
    | "fleet";

type PageTip = {
    /** Matches a `data-tip` attribute on the page. */
    target: string;
    title: string;
    body: string;
    role?: UserRole;
};

const SELECT_TIP_BODY =
    "Schaltet Kästchen an den Zeilen ein. „Abbrechen“ oder Escape beendet den Modus.";

const PAGE_TIPS: Record<TipPageId, PageTip[]> = {
    vehicles: [
        {
            target: "list-tiles",
            title: "Kachel = Filter",
            body: "Ein Klick zeigt in der Liste nur diese Fahrzeuge. Eine Kachel ist immer gewählt. Die vier Status ergeben zusammen „Alle“.",
        },
        {
            target: "list-select",
            title: "Auswählen",
            body: `Mehrere Fahrzeuge auf einmal löschen. ${SELECT_TIP_BODY}`,
            role: "dispatcher",
        },
        {
            target: "list-search",
            title: "Suche",
            body: "Sucht in Kennzeichen, Fahrer und weiteren Stammdaten, zusammen mit der gewählten Kachel.",
        },
    ],
    alerts: [
        {
            target: "list-tiles",
            title: "Kachel = Art der Warnung",
            body: "Tempo, Funk und Wenig Tank zeigen die offenen Warnungen dieser Art. „Erledigt“ ist der Verlauf. Funk und Wenig Tank schließen sich selbst, sobald das Fahrzeug wieder meldet oder getankt ist.",
        },
        {
            target: "list-select",
            title: "Mehrere erledigen",
            body: `Nur Tempo-Warnungen lassen sich von Hand erledigen. ${SELECT_TIP_BODY}`,
            role: "dispatcher",
        },
    ],
    drivers: [
        {
            target: "list-tiles",
            title: "Gespräch führen",
            body: `Fahrer mit mindestens ${DRIVER_TALK_MIN_OPEN_WARNINGS} offenen Tempo-Warnungen. „Ohne Fahrzeug“ zeigt Fahrer, die keinem Fahrzeug zugeordnet sind.`,
        },
        {
            target: "list-select",
            title: "Auswählen",
            body: `Mehrere Fahrer auf einmal löschen. Ein Fahrer auf einer Fahrt lässt sich nicht löschen. ${SELECT_TIP_BODY}`,
            role: "dispatcher",
        },
        {
            target: "list-search",
            title: "Suche",
            body: "Sucht nach Name oder Telefon, zusammen mit der gewählten Kachel.",
        },
    ],
    fleet: [
        {
            target: "fleet-tiles",
            title: "Kachel = Kartenfilter",
            body: "Die vier Status blenden die übrigen Fahrzeuge aus. Die Zahl groß ist die ganze Flotte, darunter steht, wie viele im Kartenausschnitt liegen. „Tempo jetzt“ und „Wenig Tank“ laden nur diese Fahrzeuge.",
        },
        {
            target: "fleet-search",
            title: "Fahrzeug suchen",
            body: "Ein Treffer zentriert die Karte auf das Fahrzeug und öffnet es rechts.",
        },
        {
            target: "fleet-drivers",
            title: "Fahrer filtern",
            body: "Einzelne Fahrer wählen oder einen Suchtext nehmen: „Alle Treffer filtern“ zeigt jedes Fahrzeug, dessen Fahrer oder Kennzeichen den Text enthält.",
        },
    ],
    briefing: [
        {
            target: "briefing-kpis",
            title: "Kachel = Liste",
            body: "Jede Kachel öffnet die Liste mit genau diesen Warnungen oder Fahrzeugen.",
        },
        {
            target: "briefing-due",
            title: "Fristen auf einen Blick",
            body: "Überfällig, bald fällig und fehlende Daten für HU, UVV und Führerschein. Ein Klick öffnet Fristen in diesem Stand.",
        },
    ],
    fristen: [
        {
            target: "due-tiles",
            title: "Kachel = Filter",
            body: "Ein Klick zeigt unten nur die Fristen in diesem Stand. Beim Öffnen ist „Überfällig“ gewählt.",
        },
        {
            target: "due-kinds",
            title: "Art und Regel",
            body: "Hier filterst du nach Führerschein, HU, UVV oder Führerscheinkontrolle und siehst, wie jede Frist berechnet wird.",
        },
        {
            target: "due-settings",
            title: "Vorlauf der Firma",
            body: "Wie früh eine Frist als bald fällig gilt und wie oft der Führerschein kontrolliert wird. Gespeichert wird beim Verlassen des Felds.",
            role: "dispatcher",
        },
        {
            target: "due-settings",
            title: "Vorlauf der Firma",
            body: "Wie früh eine Frist als bald fällig gilt und wie oft der Führerschein kontrolliert wird. Einstellen kann das ein Dispatcher.",
            role: "viewer",
        },
    ],
};

export const tipsForRole = (page: TipPageId, role: UserRole | undefined) =>
    PAGE_TIPS[page].filter((tip) => !tip.role || tip.role === role);

const SHOW_TIPS_EVENT = "fleet-live:show-tips";

/** The help drawer asks the open page to show its tips again. */
export function requestPageTips(page: TipPageId): void {
    window.dispatchEvent(
        new CustomEvent<TipPageId>(SHOW_TIPS_EVENT, { detail: page }),
    );
}

export function onPageTipsRequest(
    page: TipPageId,
    handler: () => void,
): () => void {
    const listener = (event: Event) => {
        if ((event as CustomEvent<TipPageId>).detail === page) {
            handler();
        }
    };

    window.addEventListener(SHOW_TIPS_EVENT, listener);

    return () => window.removeEventListener(SHOW_TIPS_EVENT, listener);
}
