# fleet-live: Welche Daten über Fahrer gespeichert werden

> **Entwurf.** Dieses Blatt beschreibt, was die Software tut. Es ist keine Rechtsberatung und ersetzt weder die Information der Beschäftigten nach Art. 13 DSGVO noch eine Betriebsvereinbarung. Eine Fachperson (Datenschutzbeauftragte, Rechtsberatung) muss es prüfen und an euren Einsatz anpassen. Was der Betrieb festlegt (Zweck, Rechtsgrundlage, Ort des Servers), steht in [eckigen Klammern].

[← zurück zur Übersicht](../README.md)

## Wofür

[Zweck eintragen, z. B. Disposition der Fahrzeuge, Nachweis gefahrener Strecken, Einhaltung von Prüffristen.]

## Was gespeichert wird

| Daten | Woher | Wie lange |
|---|---|---|
| Position, Geschwindigkeit und Zeitpunkt des Fahrzeugs | Ortungsgerät im Fahrzeug | Nur die letzten 100 Meldungen je Fahrzeug, ältere werden laufend überschrieben |
| Fahrten: Start, Ende, Strecke als Linie, Höchsttempo, wer gefahren ist | Aus den Meldungen, Fahrer zum Fahrtbeginn | Laufende Fahrten bleiben; beendete so lange, wie die Firma unter Konto → Datenschutz einstellt (Standard 90 Tage) |
| Tempo-Verstöße und Funklöcher auf einer Fahrt, mit Stelle | Aus den Meldungen | Wie die Fahrt |
| Warnungen: zu schnell (mit Fahrer), wenig Tank, kein Signal; beim Erledigen ein Vermerk wie „Gespräch geführt am …“ mit freiwilliger Notiz | Aus den Meldungen und dem Tankstand; den Vermerk schreibt ein Dispatcher | Offene bleiben; erledigte so lange, wie die Firma einstellt (Standard 90 Tage) |
| Schäden: was passiert ist, Tag und Uhrzeit, Ort als Punkt auf der Karte, wer das Fahrzeug gerade fuhr, bis zu 3 Fotos, wer gemeldet hat | Von der Firma gemeldet; Fahrer und vorgeschlagener Ort aus dem Stand beim Melden | Bis die Firma das Fahrzeug löscht; wird der Fahrer gelöscht, bleibt der Schaden ohne Verknüpfung zu ihm (der Name steht als Text dabei) |
| Fahrer-Stammdaten: Name, Telefon, Führerschein gültig bis, letzte Kontrolle | Von der Firma eingetragen oder importiert | Bis die Firma den Fahrer löscht |
| Werkstatt-Aufenthalte: Werkstatt, Termin, wer das Fahrzeug hinbringt, Ankunft, Fertigmeldung, Abholung, Kosten, Verlauf mit den Namen der Bearbeiter | Von der Firma eingetragen; Ankunft und Abholung aus der Position des Fahrzeugs | Bis die Firma das Fahrzeug löscht; wird der Fahrer gelöscht, bleibt der Aufenthalt ohne ihn |
| Monatssummen für die Übersicht (Kilometer, Zahl der Warnungen) | Aus Fahrten und Warnungen | Ohne Personenbezug, ohne Frist |
| Konten der Nutzer: Name, E-Mail, Rolle, Anmeldungen | Bei Registrierung und Einladung | Bis das Konto gelöscht wird |
| Protokoll: wer Einladungen, Rollen, Anmelde-Regeln, Datenschutz geändert oder eine Auskunft exportiert hat | Bei der Änderung | So lange, wie die Firma einstellt (Standard 365 Tage) |

## Wer was sieht

- **Dispatcher** sehen alles ihrer Firma und ändern Stammdaten, Einstellungen und Warnungen.
- **Viewer** lesen. Ob sie sehen, welcher Fahrer zu schnell war (Namen an Warnungen und Fahrten, die Fahrer-Seiten), stellt die Firma unter Konto → Datenschutz ein. Welches Fahrzeug wer gerade fährt, sehen sie immer.
- Andere Firmen sehen nichts davon.

## Auskunft

Ein Dispatcher erstellt auf der Seite des Fahrers unter „⋯“ → „Auskunft exportieren“ eine ZIP-Datei mit allem, was zu dieser Person gespeichert ist, auch den Schäden, die gemeldet wurden, während sie fuhr (Ort und Zahl der Fotos; die Fotos öffnet man am Fahrzeug). Der Export steht im Protokoll.

## Adresssuche

Richtet der Betrieb eine Adresssuche ein (`GEOCODER_URL`), schickt der Server die Adresse einer Werkstatt an diesen Dienst, wenn ein Dispatcher auf „Adresse auf der Karte suchen“ drückt. Gesendet wird nur der eingegebene Text, keine Fahrer- oder Fahrzeugdaten. [Dienst und Betreiber eintragen; der öffentliche Dienst von OpenStreetMap hat eigene Nutzungsregeln.] Ohne Einrichtung gibt es keine Suche; der Ort wird auf der Karte angeklickt.

## Nicht in fleet-live

- Keine Privatfahrten-Erkennung: [klären, ob Fahrzeuge privat genutzt werden; dann regeln, wie Ortung in dieser Zeit ausgeschlossen wird.]
- Keine Fahrer-App, keine Kamera, kein Tachograph.

## Betrieb

- Server und Daten liegen bei: [Hosting und Ort eintragen.]
- Auftragsverarbeitung: [Vertrag mit dem Betreiber eintragen.]
- Ansprechpartner: [Datenschutzbeauftragte/r eintragen.]
