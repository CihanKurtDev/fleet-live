import type { UserRole } from "@fleet-live/shared";

export type TipPageId = "briefing" | "fristen";

export type PageTip = {
    /** Matches a `data-tip` attribute on the page. */
    target: string;
    title: string;
    body: string;
    role?: UserRole;
};

export const PAGE_TIPS: Record<TipPageId, PageTip[]> = {
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
