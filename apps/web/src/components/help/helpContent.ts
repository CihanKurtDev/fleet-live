import { LOW_FUEL_THRESHOLD_PERCENT } from "@fleet-live/shared";

import type { TipPageId } from "./tipCatalog";

type HelpItem = {
    question: string;
    answer: string;
    /** Only shown to dispatchers (the action is not open to viewers). */
    dispatcherOnly?: boolean;
};

export type HelpPage = {
    id: string;
    title: string;
    intro: string;
    items: HelpItem[];
    tips?: TipPageId;
};

const SNAPSHOT_DRIVER: HelpItem = {
    question: "Welcher Fahrer steht an einer Warnung?",
    answer:
        "Der Fahrer, der beim Öffnen der Warnung aktuell am Fahrzeug war. Ein späterer Fahrerwechsel ändert das nicht.",
};

const PAGES: Record<string, HelpPage> = {
    briefing: {
        id: "briefing",
        title: "Schicht",
        intro:
            "Der Stand deiner Firma für diese Schicht: offene Warnungen, Fahrzeuge nach Status, Fristen und die Entwicklung der letzten Monate.",
        tips: "briefing",
        items: [
            {
                question: "Was passiert bei einem Klick auf eine Kachel?",
                answer:
                    "Jede Kachel öffnet die Liste mit genau diesen Einträgen: „Offen“ die offenen Warnungen, die anderen Kacheln die Fahrzeugliste mit diesem Filter.",
            },
            {
                question: "Was zählen die Fristen-Kacheln?",
                answer:
                    "HU, UVV und Führerschein: was überfällig ist, was innerhalb des Vorlaufs der Firma fällig wird und wo ein Datum fehlt. Ein Klick öffnet Fristen in diesem Stand.",
            },
            {
                question: "Was zeigen die Diagramme?",
                answer:
                    "Je Monat: wie viele Fahrer zu schnell waren, wie viele Fahrzeuge wenig Tank oder kein Signal hatten, und Tempo-Vorfälle je 1.000 km. Die genauen Zahlen stehen unter „Exakte Monatswerte anzeigen“.",
            },
            {
                question: "Was lädt „Monat“ herunter?",
                answer:
                    "Eine CSV für den laufenden Monat: Kilometer, in dem Monat angelegte Warnungen und den Verbrauch, gerechnet mit 25 l pro 100 km.",
                dispatcherOnly: true,
            },
        ],
    },
    vehicles: {
        id: "vehicles",
        tips: "vehicles",
        title: "Fahrzeuge",
        intro:
            "Alle Fahrzeuge der Firma mit Status, Tankstand, Tempo und offenen Warnungen. Ein Klick auf eine Zeile öffnet das Fahrzeug.",
        items: [
            {
                question: "Was bedeuten die Filter?",
                answer: `Die Kacheln filtern die Liste. „Mit Warnung“: Fahrzeuge mit offenen Warnungen. „Wenig Tank“: Tankstand unter ${LOW_FUEL_THRESHOLD_PERCENT} %. „Tempo jetzt“: eine Tempoüberschreitung läuft gerade. „Auf Fahrt“, „Standby“, „Feierabend“ und „Kein Signal“ sind der gemeldete Status und ergeben zusammen „Alle“. Unter „Weitere Filter“: „Kein Fahrer“ (kein aktueller Fahrer) und „Im Depot“ (letzte Position in einem Depot-Kreis).`,
            },
            {
                question: "Warum ist das Tempo orange oder rot?",
                answer:
                    "Orange: schneller als das Limit der simulierten Straße (Stadt oder Autobahn), eine Warnung ist noch nicht offen. Rot: eine Tempo-Warnung läuft. „Erledigen“ unter Warnungen ändert die Farbe nicht.",
            },
            {
                question: "Kann ich den Status ändern?",
                answer:
                    "Nein. Den Status meldet das Fahrzeug selbst. Fahrten beginnen und enden mit „Auf Fahrt“.",
            },
            {
                question: "Wie kommen neue Fahrzeuge dazu?",
                answer:
                    "Über „Fahrzeug anlegen“ oder „Importieren“ für eine CSV- oder Excel-Liste. „Exportieren“ lädt Fahrzeuge oder Fahrten der Firma als CSV.",
                dispatcherOnly: true,
            },
        ],
    },
    fleet: {
        id: "fleet",
        tips: "fleet",
        title: "Karte",
        intro:
            "Die letzte bekannte Position jedes Fahrzeugs der Firma. Fahrzeuge auf Fahrt bewegen sich live, solange sie im Ausschnitt sind.",
        items: [
            {
                question: "Was filtern die Status-Knöpfe?",
                answer:
                    "„Auf Fahrt“, „Standby“, „Feierabend“ und „Kein Signal“ zeigen auf der Karte nur diesen Status. Die Zahlen lesen sich „im Ausschnitt / gesamt“. Noch ein Klick hebt den Filter auf.",
            },
            {
                question: "Wie finde ich ein Fahrzeug?",
                answer:
                    "Kennzeichen oder Fahrer ins Suchfeld. Ein Treffer zentriert die Karte und zeigt das Fahrzeug im Feld neben der Karte, mit Link zur Detailseite.",
            },
            {
                question: "Was sind die Kreise?",
                answer:
                    "Depots der Firma. Liegt die letzte Position eines Fahrzeugs im Kreis, zählt es als „Im Depot“. Dispatcher legen Depots unter „Depots“ an: Mittelpunkt in die Karte klicken, Name und Radius setzen.",
            },
            {
                question: "Was heißt „Live“?",
                answer:
                    "Die Verbindung für Live-Daten steht. Bricht sie ab, zeigt die Karte den letzten Stand und sagt das.",
            },
        ],
    },
    alerts: {
        id: "alerts",
        tips: "alerts",
        title: "Warnungen",
        intro:
            "Der Eingang für Warnungen der Firma. „Offen“ sind Warnungen, die noch niemand erledigt hat.",
        items: [
            {
                question: "Was bedeuten Tempo, Kein Signal und Wenig Tank?",
                answer: `Tempo: ein Fahrzeug war 8 Sekunden am Stück schneller als das Limit seiner simulierten Straße (Stadt oder Autobahn). Kein Signal: 15 Sekunden ohne Meldung, während die Simulation der Firma pausiert, oder der Status „Kein Signal“. Die Warnung geht von selbst weg, sobald das Fahrzeug wieder meldet. Wenig Tank: der Tankstand liegt unter ${LOW_FUEL_THRESHOLD_PERCENT} %. Die Warnung geht von selbst weg, sobald der Tank wieder darüber liegt. Es sind dieselben Fahrzeuge wie bei „Wenig Tank“ unter Fahrzeuge.`,
            },
            {
                question: "Was macht „Erledigen“?",
                answer:
                    "Es nimmt die Warnung aus „Offen“. Der Zustand am Fahrzeug bleibt, eine laufende Tempo-Warnung bleibt rot. Erledigen dürfen nur Dispatcher. „Wenig Tank“ und „Kein Signal“ gibt es nicht zum Erledigen: die Warnung geht von selbst weg, sobald getankt ist bzw. das Fahrzeug wieder meldet. Eine beendete Tempo-Warnung, die niemand erledigt, wird nach 7 Tagen Verlauf und steht dann unter „Erledigt“. Erledigte Warnungen bleiben 90 Tage sichtbar, die Monatszahlen der Diagramme bleiben.",
            },
            {
                question: "Wohin führt eine Zeile?",
                answer:
                    "Zum Fahrzeug, mit Karte, Fahrten, Fahrern und offenen Hinweisen.",
            },
            SNAPSHOT_DRIVER,
        ],
    },
    due: {
        id: "due",
        title: "Fristen",
        intro:
            "Termine, die das Büro nachhalten muss: HU und UVV je Fahrzeug, Führerschein-Ablauf und Führerscheinkontrolle je Fahrer. Je Art eine Gruppe, das Dringendste oben.",
        tips: "fristen",
        items: [
            {
                question: "Überfällig, bald fällig, Datum fehlt",
                answer:
                    "Überfällig: das Datum ist vorbei. Die mittlere Kachel („In … Tagen“): fällig innerhalb des Vorlaufs der Firma. Datum fehlt: für HU, UVV oder Führerschein-Ablauf ist nichts eingetragen. Eine fehlende oder zu alte Führerscheinkontrolle zählt als überfällig, solange die Kontrolle eingeschaltet ist.",
            },
            {
                question: "Wo wird der Vorlauf eingestellt?",
                answer:
                    "Rechts unter „Einstellungen der Firma“: der Vorlauf in Tagen (0 bis 365) und wie oft der Führerschein kontrolliert wird (0 bis 24 Monate, 0 schaltet sie aus). Das gilt für die ganze Firma. Ändern dürfen Dispatcher, mit Leserechten siehst du die Werte.",
            },
            {
                question: "Wie trage ich ein Datum ein?",
                answer:
                    "Ein Klick auf eine Zeile öffnet das Fahrzeug oder den Fahrer, dort unter „Bearbeiten“. Viele Daten auf einmal gehen über den Import.",
            },
            {
                question: "Sind Fristen Warnungen?",
                answer:
                    "Nein. Fristen stehen nicht unter Warnungen. Ihre Zahlen zeigt die Schicht-Seite.",
            },
        ],
    },
    drivers: {
        id: "drivers",
        tips: "drivers",
        title: "Fahrer",
        intro:
            "Alle Fahrer der Firma, oben die mit den meisten offenen Warnungen. Ein Klick öffnet den Fahrer.",
        items: [
            {
                question: "Was zählen „Verstöße“ und „Davon offen“?",
                answer:
                    "Verstöße sind alle Tempo-Warnungen des Fahrers, „Davon offen“ die noch nicht erledigten. Tank und Kein Signal hängen am Fahrzeug, nicht am Fahrer.",
            },
            {
                question: "Wie lege ich einen Fahrer an?",
                answer:
                    "Über „Fahrer anlegen“. Danach öffnet sich der Fahrer, dort weist du Fahrzeuge zu.",
                dispatcherOnly: true,
            },
            SNAPSHOT_DRIVER,
        ],
    },
    vehicleDetail: {
        id: "vehicleDetail",
        title: "Fahrzeug",
        intro:
            "Ein Fahrzeug: Tempo, Tank und letzte Meldung, Stammdaten, Position, Fahrten, Fahrer und offene Hinweise.",
        items: [
            {
                question: "Was zeigt die Linie auf der Karte?",
                answer:
                    "Die ausgewählte Fahrt. Eine laufende Fahrt wächst live mit, eine abgeschlossene Fahrt aus „Fahrten“ zeigt ihren gespeicherten Weg.",
            },
            {
                question: "„Aktuell“ und „Freigegeben“",
                answer:
                    "Aktuell ist der Fahrer, der gerade am Fahrzeug steht; nur er erscheint in den Übersichten. Freigegeben darf das Fahrzeug fahren. Während einer Fahrt lässt sich der aktuelle Fahrer nicht wechseln.",
            },
            {
                question: "Was steht unter „Hinweise“?",
                answer:
                    "Offene Hinweise zu Tank und Kein Signal an diesem Fahrzeug. Tempo-Warnungen stehen unter Warnungen und am Fahrer.",
            },
            {
                question: "Wo ändere ich HU, UVV oder den Stammstandort?",
                answer:
                    "Unter „Bearbeiten“. Den Status meldet das Fahrzeug selbst.",
                dispatcherOnly: true,
            },
        ],
    },
    driverDetail: {
        id: "driverDetail",
        title: "Fahrer",
        intro:
            "Ein Fahrer: Telefon, Fahrzeuge, Führerschein-Daten und Tempo-Verstöße.",
        items: [
            {
                question: "„Aktuell“ und „Freigegeben“",
                answer:
                    "Aktuell ist das Fahrzeug, an dem der Fahrer gerade steht; nur das erscheint in den Übersichten. Freigegebene Fahrzeuge darf er fahren.",
            },
            {
                question: "Woher kommen die Führerschein-Fristen?",
                answer:
                    "Aus „Gültig bis“ und „Kontrolliert am“. Beides steht unter „Bearbeiten“; die Termine erscheinen dann unter Fristen.",
            },
            {
                question: "Was zählt unter „Verstöße“?",
                answer:
                    "Nur Tempo-Warnungen. Tank und Kein Signal hängen am Fahrzeug.",
            },
        ],
    },
    import: {
        id: "import",
        title: "Import",
        intro:
            "Fahrzeuge, Fahrer und Zuordnungen aus einer Datei übernehmen: Datei wählen, Spalten zuordnen, Vorschau prüfen, importieren.",
        items: [
            {
                question: "Welche Dateien gehen?",
                answer:
                    "CSV mit Fahrzeugen oder Excel (.xlsx) mit Blättern für Fahrzeuge, Fahrer, Freigaben und Besatzung. Alte .xls-Dateien vorher als .xlsx speichern. Beispieldateien liegen unter dem Upload.",
            },
            {
                question: "Was sehe ich vor dem Import?",
                answer:
                    "Eine Vorschau: was neu ist, was aktualisiert wird und welche Zeilen Fehler haben. Zeilen mit Fehlern werden übersprungen.",
            },
            {
                question: "Kann ein Import halb hängen bleiben?",
                answer:
                    "Nein. Übernommen wird in einem Schritt. Scheitert das Speichern, bleibt alles wie vorher.",
            },
            {
                question: "Was heißt „Als Firmenprofil merken“?",
                answer:
                    "Die Spalten- und Statuszuordnung wird für den nächsten Import dieser Firma gespeichert.",
            },
        ],
    },
    account: {
        id: "account",
        title: "Konto",
        intro:
            "Dein Zugang: Passwort, Zwei-Faktor und weitere Firmen. Dispatcher laden hier ein und stellen den Firmen-Login ein.",
        items: [
            {
                question: "Wie richte ich Zwei-Faktor ein?",
                answer:
                    "„Einrichtung starten“, den QR-Code mit einer Authenticator-App scannen und den Code bestätigen. Danach siehst du Wiederherstellungscodes; bewahre sie auf.",
            },
            {
                question: "Wie lade ich jemanden ein?",
                answer:
                    "Unter „Team und Einladungen“: E-Mail und Rolle. „Dispatcher“ darf ändern, „Nur lesen“ sieht die Firma, ändert aber nichts. In der Firma ist die Person erst, wenn sie annimmt; bis dahin steht sie mit „Einladung offen“ im Team, und du kannst die Einladung zurückziehen.",
                dispatcherOnly: true,
            },
            {
                question: "Ich wurde in eine weitere Firma eingeladen. Wo nehme ich an?",
                answer:
                    "Unter „Firma wechseln oder anlegen“ stehen deine Einladungen mit „Annehmen“ und „Ablehnen“. Die Zahl am Namen oben rechts zeigt, wie viele warten.",
            },
            {
                question: "Was steht im Protokoll?",
                answer:
                    "Wer in dieser Firma eingeladen, Rollen geändert, jemanden entfernt, die Anmelde-Regeln oder Domains geändert hat, mit Zeitpunkt.",
                dispatcherOnly: true,
            },
            {
                question: "Wie lange bewahrt fleet-live Fahrten und Warnungen auf?",
                answer:
                    "Unter „Datenschutz“ stellt ihr ein, nach wie vielen Tagen Fahrten, erledigte Warnungen und das Protokoll gelöscht werden (leer = Standard). Meist legt das eine Betriebsvereinbarung fest. Was älter ist, wird beim Speichern sofort gelöscht.",
                dispatcherOnly: true,
            },
            {
                question: "Wozu trage ich beim Firmen-Login eine Domain ein?",
                answer:
                    "Mit einer bestätigten Domain (z. B. firma.de) findet die Anmeldeseite euren Firmen-Login über die E-Mail-Adresse. Bestätigt wird mit einem TXT-Eintrag im DNS eurer Domain; danach „Prüfen“.",
                dispatcherOnly: true,
            },
            {
                question: "Wofür ist „Weitere Firma“?",
                answer:
                    "Legt eine neue Firma an und wechselt hinein. Zwischen deinen Firmen wechselst du oben rechts.",
            },
        ],
    },
};

/** Help for a route, or null where the app has none (login, not found). */
export function helpForPath(pathname: string): HelpPage | null {
    const path = pathname.replace(/\/+$/, "") || "/";

    if (path === "/") return PAGES.briefing;
    if (path === "/vehicles") return PAGES.vehicles;
    if (path === "/vehicles/import") return PAGES.import;
    if (/^\/vehicles\/[^/]+$/.test(path)) return PAGES.vehicleDetail;
    if (path === "/fleet") return PAGES.fleet;
    if (path === "/alerts") return PAGES.alerts;
    if (path === "/fristen") return PAGES.due;
    if (path === "/drivers") return PAGES.drivers;
    if (/^\/drivers\/[^/]+$/.test(path)) return PAGES.driverDetail;
    if (path === "/konto") return PAGES.account;

    return null;
}
