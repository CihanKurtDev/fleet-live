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
                    "Jede Kachel öffnet die Liste mit genau diesen Einträgen: „Offen“ die offenen Warnungen, die anderen Kacheln die Fahrzeugliste mit diesem Filter. „Ausfall“ sind die Fahrzeuge, die heute nicht fahren: in der Werkstatt, nicht fahrbereit oder außer Dienst.",
            },
            {
                question: "Was zählen die Fristen-Kacheln?",
                answer:
                    "HU, UVV und Führerschein: was überfällig ist, was innerhalb des Vorlaufs der Firma fällig wird und wo ein Datum fehlt. Ein Klick öffnet Fristen in diesem Stand.",
            },
            {
                question: "Was zeigen die Diagramme?",
                answer:
                    "Zwei Diagramme zu Tempo, je Monat. „Wie viele Fahrer waren zu schnell?“: der Anteil der Fahrer, die in dem Monat gefahren sind und mindestens einmal zu schnell waren; ein Fahrer zählt einmal, egal wie oft. Die gestrichelte Linie ist der Schnitt der Vormonate mit Fahrten (Monate ohne Daten zählen nicht mit). „Passiert das oft?“: Tempo-Vorfälle je 1.000 km, damit die Zahl vergleichbar bleibt, wenn die Flotte mehr fährt; die Balken zeigen den Anteil der deutlichen Überschreitungen. Eine Tempo-Warnung entsteht erst ab 10 km/h über dem Limit. Wenig Tank und Kein Signal stehen in der Monatstabelle unter „Exakte Monatswerte anzeigen“: Fahrzeuge, die in dem Monat eine solche Warnung hatten. Sind die Fahrten eines Monats schon gelöscht, steht bei den aktiven Fahrern „—“.",
            },
            {
                question: "Was lädt „Monat“ herunter?",
                answer:
                    "Eine CSV für den laufenden Monat: Kilometer, in dem Monat angelegte Warnungen und einen geschätzten Verbrauch. Die Schätzung rechnet pauschal 25 l pro 100 km, für PKW wie LKW gleich; gemessen ist sie nicht.",
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
                answer: `Die Kacheln filtern die Liste. „Mit Warnung“: Fahrzeuge mit offenen Warnungen. „Wenig Tank“: Tankstand unter ${LOW_FUEL_THRESHOLD_PERCENT} %. „Tempo jetzt“: eine Tempoüberschreitung läuft gerade. „Auf Fahrt“, „Standby“, „Feierabend“ und „Kein Signal“ sind der gemeldete Status und ergeben zusammen „Alle“. „Ausfall“: fährt heute nicht (Werkstatt, nicht fahrbereit, außer Dienst). Unter „Weitere Filter“ unter anderem „Kein Fahrer“, „In der Werkstatt“, „Frist abgelaufen“ und „Frist bald fällig“ (HU oder UVV, dieselbe Regel wie unter Fristen) und „Im Depot“ (letzte Position in einem Depot-Kreis).`,
            },
            {
                question: "Was heißen die gelben Markierungen bei HU und UVV?",
                answer:
                    "Gelb mit Punkt: abgelaufen oder heute fällig, dazu steht „HU abgelaufen“ oder „UVV heute“ bei den Hinweisen. Ein Ring: fällig innerhalb des Vorlaufs der Firma. Hat das Fahrzeug schon einen Werkstatt-Termin dafür, sagt der Hinweis „Werkstatt“ mit dem Termin.",
            },
            {
                question: "Warum ist das Tempo orange oder rot?",
                answer:
                    "Orange: schneller als das Limit der simulierten Straße (Stadt, Zubringer oder Autobahn; ein LKW hat außerorts niedrigere Stufen), eine Warnung ist noch nicht offen. Rot: eine Tempo-Warnung läuft, ab 10 km/h über dem Limit. „Erledigen“ unter Warnungen ändert die Farbe nicht. Die Limits sind Klassen der Demo, keine Rechtsangabe.",
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
                    "Durchgezogen: Depots der Firma. Liegt die letzte Position eines Fahrzeugs im Kreis, zählt es als „Im Depot“. Gestrichelt: Werkstätten; parkt ein Fahrzeug mit Termin im Kreis, gilt es als angekommen.",
            },
            {
                question: "Was steht im Band unter der Karte?",
                answer:
                    "Die Orte im Kartenausschnitt, die belebten zuerst. Ein Depot zeigt, wie viele Fahrzeuge dort zu Hause sind, als Balken in den Farben der Punkte, und wie viele gerade bereitstehen und im Depot sind. Eine Werkstatt zeigt, wer dort steht und wer einen Termin hat. „N Orte“ öffnet die Liste aller Orte mit Suche, „+ N außerhalb“ ebenso. Ein Klick fährt hin und öffnet die Karte des Orts; Dispatcher bearbeiten ihn dort, eine Werkstatt auch mit Adresssuche (wenn eingerichtet) und Löschen, solange kein offener Termin sie nutzt. „+ Neuer Ort“ legt ein Depot (in die Karte klicken) oder eine Werkstatt an.",
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
                answer: `Tempo: ein Fahrzeug war 8 Sekunden am Stück mindestens 10 km/h schneller als das Limit seiner simulierten Straße. Ein Klick öffnet das Fahrzeug mit der Fahrt, auf der es passiert ist. Viele offene Tempo-Warnungen eines Fahrers erledigst du auf seiner Seite mit „Gespräch geführt“ auf einmal. Kein Signal: 15 Sekunden ohne Meldung, während die Simulation der Firma pausiert, oder der Status „Kein Signal“. Die Warnung geht von selbst weg, sobald das Fahrzeug wieder meldet. Wenig Tank: der Tankstand liegt unter ${LOW_FUEL_THRESHOLD_PERCENT} %. Die Warnung geht von selbst weg, sobald der Tank wieder darüber liegt. Es sind dieselben Fahrzeuge wie bei „Wenig Tank“ unter Fahrzeuge.`,
            },
            {
                question: "Was macht „Erledigen“?",
                answer:
                    "Es nimmt die Warnung aus „Offen“. Der Zustand am Fahrzeug bleibt, eine laufende Tempo-Warnung bleibt rot. Erledigen dürfen nur Dispatcher. „Wenig Tank“ und „Kein Signal“ gibt es nicht zum Erledigen: die Warnung geht von selbst weg, sobald getankt ist bzw. das Fahrzeug wieder meldet. Eine beendete Tempo-Warnung, die niemand erledigt, wird nach 7 Tagen Verlauf und steht dann unter „Erledigt“. Erledigte Warnungen bleiben so lange sichtbar, wie die Firma unter Konto → Datenschutz festlegt (ohne Einstellung 90 Tage); die Zahl steht oben auf der Seite. Die Monatszahlen der Diagramme bleiben.",
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
                question: "„Termin planen“ bei HU und UVV",
                answer:
                    "Plant den Werkstatt-Aufenthalt für dieses Fahrzeug. Danach steht in der Zeile der Termin oder „In der Werkstatt“. Wer „Fertig melden“ drückt, trägt bei der HU den neuen Monat ein; die Zeile verschwindet dann aus der Liste.",
                dispatcherOnly: true,
            },
            {
                question: "„Neues Ablaufdatum“ und „Kontrolle eintragen“",
                answer:
                    "Öffnen den Fahrer mit dem passenden Feld: das neue Ablaufdatum des Führerscheins oder den Tag, an dem du ihn kontrolliert hast. Danach rechnet die Liste neu.",
                dispatcherOnly: true,
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
            "Ein Fahrzeug: Tempo, Tank und letzte Meldung, Werkstatt, Stammdaten, Position, Fahrten, Fahrer und offene Hinweise.",
        items: [
            {
                question: "Wie läuft ein Werkstatt-Aufenthalt?",
                answer:
                    "„In die Werkstatt“ plant einen Termin: was gemacht wird (offene Schäden, HU, UVV, Wartung, Sonstiges zum Abhaken; Fälliges ist vorausgewählt, ein Aufenthalt erledigt alles), Werkstatt (nach Entfernung ab dem Stammdepot sortiert, sonst ab der letzten Position; die nächste im Umkreis von 50 km wird vorgeschlagen, eine weiter entfernte fragt nach; eine neue legst du dort an, mit Ort auf der Karte), Tag, Uhrzeit, wann es fertig sein soll, wie es hinkommt (Fahrer bringt, Abschleppen, Werkstatt holt ab; nicht fahrbereit nie mit Fahrer), wer es hinbringt (die Liste sagt, wer gerade fährt oder schon etwas bringt) und wer zuständig ist. Angekommen ist es, sobald es im Kreis der Werkstatt parkt; „Angekommen melden“ von Hand gibt es nur, solange es steht, für Fahrzeuge ohne Signal. In der Werkstatt bekommt es keinen Fahrer, bis „Fertig melden“ es zurückgibt. Bei einer HU trägst du dabei den neuen Monat von der Plakette ein, bei einer UVV gilt das Fertig-Datum als Prüfung; Kosten kannst du später im „Verlauf“ nachtragen. Abgeholt ist es, sobald es den Kreis verlässt; fehlt ein Fahrer, sagt der Streifen das. Ist ein Termin vorbei und das Fahrzeug war nie dort, steht er rot als „Verpasst“.",
            },
            {
                question: "Wie melde ich einen Schaden?",
                answer:
                    "„Schaden melden“ steht im Kopf von „Hinweise“: was passiert ist, Schwere, ob das Fahrzeug noch fahren kann, wann (Tag und Uhrzeit), wer gerade fuhr, wo (der Punkt der letzten Meldung, ein Klick auf die Karte setzt ihn neu) und bis zu 3 Fotos. Nicht fahrbereit heißt: es bekommt keinen Fahrer, bis der Schaden behoben ist; auf Fahrt (Panne) hält es an und die Fahrt endet. Mit „Danach Werkstatt-Termin planen“ geht es gleich weiter zum Termin („Melden und Termin planen“). Offene Schäden stehen unter „Hinweise“ mit „Termin planen“; ein Termin mit Grund „Schaden“ nimmt sie auf, und „Fertig melden“ setzt sie auf behoben. Einen kleinen Schaden ohne Werkstatt erledigst du, indem du ihn unter „Hinweise“ öffnest.",
                dispatcherOnly: true,
            },
            {
                question: "Was heißt „Außer Dienst“?",
                answer:
                    "Das Fahrzeug wird keinem Fahrer zugewiesen, bis es wieder in Dienst gestellt ist. Beides steht unter „Weitere Aktionen“ (⋯), nicht während das Fahrzeug in der Werkstatt ist.",
                dispatcherOnly: true,
            },
            {
                question: "Woher kommt der Kilometerstand?",
                answer:
                    "Das steht unter „Jetzt“. Ein LKW meldet den Tachostand selbst, sobald er fährt; den kann niemand ändern. Transporter und PKW haben eine GPS-Box, die den Tacho nicht liest: dort trägt man den Stand einmal ein, danach rechnet fleet-live jede gemeldete Strecke dazu („≈“, weil GPS-Strecke mit der Zeit vom Tacho abweicht). „Korrigieren“ zeigt, wer ihn wann gesetzt hat, und nimmt den abgelesenen Stand; beim „Fertig melden“ geht auch der Stand laut Werkstattrechnung.",
            },
            {
                question: "Was zeigt die Linie auf der Karte?",
                answer:
                    "Die ausgewählte Fahrt. Eine laufende Fahrt wächst live mit, eine abgeschlossene Fahrt aus „Fahrten“ zeigt ihren gespeicherten Weg. Die Demo fährt im Zeitraffer (×5, steht an „Fahrten“): Strecke und Dauer einer Fahrt passen deshalb nicht zur Uhr.",
            },
            {
                question: "„Aktuell“ und „Freigegeben“",
                answer:
                    "Aktuell ist der Fahrer, der gerade am Fahrzeug steht; nur er erscheint in den Übersichten. Freigegeben darf das Fahrzeug fahren. Während einer Fahrt lässt sich der aktuelle Fahrer nicht wechseln.",
            },
            {
                question: "Was steht unter „Hinweise“?",
                answer:
                    "Was an diesem Fahrzeug offen ist: Schäden, eine laufende Tempo-Warnung („Fahrt zeigen“ öffnet die Fahrt), Kein Signal mit Dauer und der Telefonnummer des Fahrers, wenig Tank und HU oder UVV, die abgelaufen sind oder fehlen (mit „Termin planen“ oder „Zum Termin dazu“, wenn schon ein Termin ansteht).",
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
            {
                question: "Was tut „Gespräch geführt“?",
                answer:
                    "Nach einem Gespräch mit dem Fahrer erledigt es alle seine offenen Tempo-Warnungen auf einmal, mit dem Vermerk „Gespräch geführt am …“ und einer freiwilligen Notiz.",
                dispatcherOnly: true,
            },
            {
                question: "Warum lässt sich ein Fahrer nicht zuweisen?",
                answer:
                    "Ist sein Führerschein abgelaufen, darf er weder ein Fahrzeug fahren noch eines in die Werkstatt bringen. Ist er schon eingeteilt, steht das oben unter „Hinweise“ mit „Abnehmen“ und ganz oben in „Heute dran“. Eine Kontrolle nach dem Ablaufdatum zählt erst mit einem neuen Ablaufdatum.",
            },
            {
                question: "Ein Fahrer will wissen, was über ihn gespeichert ist. Was tue ich?",
                answer:
                    "Hier unter „⋯“ → „Auskunft exportieren“. Die ZIP-Datei enthält Stammdaten, Fahrzeuge, Fahrten mit Strecke, Verstöße, Warnungen, Werkstatt-Fahrten und Schäden aus seiner Zeit am Steuer und erklärt in liesmich.txt, was drin ist. Der Export steht im Protokoll.",
                dispatcherOnly: true,
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
                question: "Wer sieht, welcher Fahrer zu schnell war?",
                answer:
                    "Dispatcher immer. Viewer nur, solange unter „Datenschutz“ „Viewer sehen Fahrernamen bei Verstößen“ an ist; sonst fehlen ihnen die Namen an Warnungen und Fahrten und die Fahrer-Seiten.",
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
