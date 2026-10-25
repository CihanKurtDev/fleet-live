# Sicherheit

## Schwachstellen melden

Eine Kontaktadresse für Sicherheitsmeldungen ist **noch nicht festgelegt**. Bis sie hier steht:

* keine Details zu einer Schwachstelle in öffentlichen Issues, Pull Requests oder Diskussionen;
* den Maintainer über GitHub (Profil `CihanKurtDev`) ansprechen und nur um einen privaten Kanal bitten;
* sobald das Repository es anbietet, „Report a vulnerability“ (GitHub Private Vulnerability Reporting) nutzen.

Noch zu entscheiden und hier einzutragen: Kontaktadresse oder Formular, Antwortzeit, Ablauf bis zur Veröffentlichung, ob es eine Danksagung gibt.

## Was unterstützt wird

Es gibt keine Releases. Sicherheitsfixes gehen auf `main`. fleet-live ist eine Demo- und Lernanwendung, kein betriebener Dienst; den Zustand der einzelnen Punkte zeigt [`docs/security-remediation-plan.md`](docs/security-remediation-plan.md).

## Wie die Anwendung schützt (Kurzfassung)

* **Anmeldung:** Passwort (scrypt), Zwei-Faktor (TOTP mit Wiederherstellungscodes), Google, Microsoft und je Firma ein eigener OIDC-Login. Vor jeder neuen Sitzung entscheidet eine Stelle (`apps/api/src/models/loginPolicy.ts`), was noch fehlt: ein zweiter Faktor, den das Konto oder die Firma verlangt, oder der Firmen-Login, wenn die Firma ihn verlangt. Die MFA eines Identity Providers ersetzt den zweiten Faktor nicht.
* **Externe Identitäten** sind an Issuer und Subject des geprüften ID-Tokens gebunden, nie an eine E-Mail. Verknüpft wird nur ausdrücklich durch den angemeldeten Inhaber, oder einmalig nach Passwort und zweitem Faktor für den Firmen-Login einer Firma, die ihn verlangt. Dabei muss der Provider genau die bestätigte E-Mail des Kontos melden.
* **Sitzungen:** Das Cookie (HttpOnly, SameSite=Lax, in Produktion Secure) trägt ein zufälliges Token, die Datenbank nur dessen SHA-256. Jede Anfrage prüft die Sitzung gegen die aktuellen Regeln ihrer Firma (`apps/api/src/models/sessionPolicy.ts`). Eine Sitzung aus dem Firmen-Login gilt nur für diese Firma.
* **Mandanten:** Die Firma kommt aus der Sitzung, nie aus dem Request. Fremde Datensätze sind `404`. `viewer` liest, `dispatcher` schreibt.
* **Live-Strom (SSE):** Jede Verbindung gehört zu einer Sitzung und Firma. Sie endet bei Logout, Passwortwechsel, entfernter Mitgliedschaft, Rollen- oder Firmenwechsel und wenn die Firma ihre Anmelderegeln ändert.
* **OIDC-Anfragen** gehen nur per HTTPS an öffentliche Adressen (nach DNS geprüft), ohne Weiterleitungen, mit Zeit- und Größenlimit. Interne IdPs nur über `OIDC_PRIVATE_HOSTS`.
* **Importe und Exporte:** begrenzte Größe, Zeilen und Zip-Einträge (vor dem Entpacken geprüft), CSV-Zellen ohne Formelstart.

## Betrieb

Wer fleet-live selbst betreibt, braucht mindestens:

* `NODE_ENV=production`, HTTPS davor, `CORS_ORIGIN` und `WEB_ORIGIN` auf die echte Origin;
* ein zufälliges, geheim gehaltenes `TOTP_ENCRYPTION_KEY` (verschlüsselt TOTP- und OIDC-Client-Geheimnisse; nicht im Repository, nicht im Backup derselben Datenbank);
* `TRUST_PROXY_HOPS` nur, wenn ein Proxy `X-Forwarded-For` wirklich überschreibt;
* genau eine Instanz: Rate-Limits, Fehlversuche, Live-Strom und Import-Vorschauen liegen im Speicher des Prozesses;
* geschützte Backups der SQLite-Datei (sie enthält Passwort- und Token-Hashes und verschlüsselte Geheimnisse);
* keine Demo-Konten (`ALLOW_DEMO_ACCOUNTS` aus; die Produktion startet nicht, solange sie existieren).

Details und offene Punkte: [`docs/security-remediation-plan.md`](docs/security-remediation-plan.md).
