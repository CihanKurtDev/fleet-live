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
| Warnungen: zu schnell (mit Fahrer), wenig Tank, kein Signal | Aus den Meldungen und dem Tankstand | Offene bleiben; erledigte so lange, wie die Firma einstellt (Standard 90 Tage) |
| Fahrer-Stammdaten: Name, Telefon, Führerschein gültig bis, letzte Kontrolle | Von der Firma eingetragen oder importiert | Bis die Firma den Fahrer löscht |
| Monatssummen für die Übersicht (Kilometer, Zahl der Warnungen) | Aus Fahrten und Warnungen | Ohne Personenbezug, ohne Frist |
| Konten der Nutzer: Name, E-Mail, Rolle, Anmeldungen | Bei Registrierung und Einladung | Bis das Konto gelöscht wird |
| Protokoll: wer Einladungen, Rollen, Anmelde-Regeln, Datenschutz geändert oder eine Auskunft exportiert hat | Bei der Änderung | So lange, wie die Firma einstellt (Standard 365 Tage) |

## Wer was sieht

- **Dispatcher** sehen alles ihrer Firma und ändern Stammdaten, Einstellungen und Warnungen.
- **Viewer** lesen. Ob sie sehen, welcher Fahrer zu schnell war (Namen an Warnungen und Fahrten, die Fahrer-Seiten), stellt die Firma unter Konto → Datenschutz ein. Welches Fahrzeug wer gerade fährt, sehen sie immer.
- Andere Firmen sehen nichts davon.

## Auskunft

Ein Dispatcher erstellt auf der Seite des Fahrers unter „⋯“ → „Auskunft exportieren“ eine ZIP-Datei mit allem, was zu dieser Person gespeichert ist. Der Export steht im Protokoll.

## Nicht in fleet-live

- Keine Privatfahrten-Erkennung: [klären, ob Fahrzeuge privat genutzt werden; dann regeln, wie Ortung in dieser Zeit ausgeschlossen wird.]
- Keine Fahrer-App, keine Kamera, kein Tachograph.

## Betrieb

- Server und Daten liegen bei: [Hosting und Ort eintragen.]
- Auftragsverarbeitung: [Vertrag mit dem Betreiber eintragen.]
- Ansprechpartner: [Datenschutzbeauftragte/r eintragen.]
