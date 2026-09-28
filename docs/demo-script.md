# Demo-Skript (60–90 Sekunden)

Vorbereitung: `npm run db:seed`, Anwendung starten, Browser auf 1366×768, Dispatcher-Zugang bereithalten. Keine personenbezogenen oder lokalen Daten einblenden.

## Ablauf

**0–8 s — Login**
- Loginseite zeigen und als Dispatcher anmelden.
- Sprechertext: „fleet-live ist eine TypeScript-Flottenleitstelle mit Session-Login und mandantengetrennten Daten.“

**8–20 s — Schichtüberblick**
- Briefing mit Statuszahlen und offenen Warnungen zeigen.
- Sprechertext: „Die Startseite bündelt den aktuellen Flottenzustand, Ausfälle und die wichtigsten Aufgaben der Schicht.“

**20–35 s — Flottenkarte**
- Zur Flottenkarte wechseln, Statusfilter zeigen und eine Dichtezelle öffnen.
- Nach einem Kennzeichen suchen, sodass die Karte zum Fahrzeug springt.
- Sprechertext: „Die Karte aggregiert große Ergebnismengen serverseitig und wechselt beim Hineinzoomen zu Live-Markern.“

**35–52 s — Fahrzeug und Fahrt**
- Einen Marker öffnen. Karte, laufende Fahrt und Live-Bewegung zeigen.
- Sprechertext: „SSE liefert nur fokussierte Telemetrie. Der dauerhafte Fahrweg liegt kompakt als codierte Polyline in der Fahrt.“

**52–65 s — Warnungen**
- Warnungs-Inbox öffnen, Typfilter zeigen und eine Warnung erledigen.
- Sprechertext: „Geschwindigkeits- und Offline-Ereignisse werden live erkannt; Bearbeitung und Fahrer-Snapshot bleiben nachvollziehbar.“

**65–80 s — Stammdatenimport**
- Import-Assistent öffnen und eine vorbereitete CSV/XLSX bis zur Vorschau zeigen.
- Sprechertext: „Stammdaten werden vor dem Commit validiert, zugeordnet und anschließend transaktional importiert.“

**80–90 s — Abschluss**
- Zur Flottenkarte oder zum Briefing zurückkehren.
- Sprechertext: „Die Demo simuliert GPS bewusst lokal. Architektur, Verträge, Tests und Tenant-Isolation sind für ein realistisches Produktbeispiel ausgearbeitet.“

## Aufnahme-Checkliste
- Standard-Seed verwenden, Simulation laufen lassen.
- Light Theme für den Hauptclip; Dark Theme kurz separat prüfen.
- Keine DevTools, Benachrichtigungen oder Passwortmanager-Pop-ups.
- Video extern hosten oder als komprimiertes MP4/WebM verlinken; keine großen Binärdateien ins Repository legen.
