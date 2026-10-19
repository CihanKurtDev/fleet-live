import {
    useEffect,
    useId,
    useRef,
    useState,
    type CSSProperties,
} from "react";
import { Link } from "react-router";

import { HeroMapCanvas } from "../components/landing/HeroMapCanvas";
import styles from "./LandingPage.module.scss";

const SECTIONS = [
    { href: "#schicht", label: "Eine Schicht" },
    { href: "#signale", label: "Signale" },
    { href: "#einrichten", label: "Einrichten" },
    { href: "#fragen", label: "Fragen" },
];

type Row = { lead: string; sub?: string; tag?: [string, "t" | "f" | "k" | "cur"]; detail?: string };

const Fragment = ({
    label,
    head,
    count,
    rows,
    columns,
}: {
    label: string;
    head: string;
    count: string;
    rows: Row[];
    columns: string;
}) => (
    <div className={styles.frag} role="img" aria-label={label}>
        <div className={styles.fragHead} aria-hidden="true">
            <span>{head}</span>
            <span>{count}</span>
        </div>
        <div aria-hidden="true">
            {rows.map((row) => (
                <div
                    key={row.lead + (row.detail ?? "")}
                    className={styles.fragRow}
                    style={{ gridTemplateColumns: columns }}
                >
                    <span>
                        <span className={styles.plate}>{row.lead}</span>
                        {row.sub && (
                            <>
                                <br />
                                <span className={styles.dim}>{row.sub}</span>
                            </>
                        )}
                    </span>
                    {row.tag && (
                        <span className={`${styles.tag} ${styles[row.tag[1]]}`}>
                            {row.tag[0]}
                        </span>
                    )}
                    {row.detail && <span className={styles.dim}>{row.detail}</span>}
                </div>
            ))}
        </div>
    </div>
);

/**
 * Public start page for visitors who are not signed in. Signed-in people get
 * Schicht on the same path (`HomeRoute`).
 */
export const LandingPage = () => {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuId = useId();
    const toggleRef = useRef<HTMLButtonElement>(null);
    const heroRef = useRef<HTMLElement>(null);
    // Clear over the map; a solid bar once the map has scrolled past it.
    const [solid, setSolid] = useState(false);

    useEffect(() => {
        const hero = heroRef.current;

        if (!hero || typeof IntersectionObserver === "undefined") {
            return;
        }

        const observer = new IntersectionObserver(
            ([entry]) => setSolid(!entry.isIntersecting),
            // The hero counts as gone when its bottom passes under the bar.
            { rootMargin: "-76px 0px 0px 0px" },
        );
        observer.observe(hero);

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!menuOpen) {
            return;
        }

        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setMenuOpen(false);
                toggleRef.current?.focus();
            }
        };

        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [menuOpen]);

    return (
        <div className={styles.page}>
            <title>fleet-live · Flottenleitstelle für Disponenten</title>

            <header
                className={styles.siteHead}
                data-solid={solid || menuOpen || undefined}
            >
                <div className={`${styles.wrap} ${styles.headRow}`}>
                    <Link className={styles.brand} to="/">
                        fleet-live <small>Leitstelle</small>
                    </Link>
                    <nav className={styles.nav} aria-label="Abschnitte">
                        {SECTIONS.map((section) => (
                            <a key={section.href} href={section.href}>
                                {section.label}
                            </a>
                        ))}
                    </nav>
                    <div className={styles.headActions}>
                        <Link className={`${styles.btn} ${styles.btnLine}`} to="/login">
                            Anmelden
                        </Link>
                        <Link className={`${styles.btn} ${styles.btnGo}`} to="/registrieren">
                            Firma registrieren
                        </Link>
                    </div>
                    <button
                        ref={toggleRef}
                        type="button"
                        className={styles.menuToggle}
                        aria-expanded={menuOpen}
                        aria-controls={menuId}
                        aria-label={menuOpen ? "Menü schließen" : "Menü öffnen"}
                        onClick={() => setMenuOpen((open) => !open)}
                    >
                        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                            <path
                                d={menuOpen ? "M5 5l10 10M15 5L5 15" : "M3 6h14M3 10h14M3 14h14"}
                                stroke="currentColor"
                                strokeWidth="1.8"
                                fill="none"
                            />
                        </svg>
                    </button>
                </div>
                <nav
                    id={menuId}
                    className={styles.mobileNav}
                    data-open={menuOpen || undefined}
                    aria-label="Menü"
                    onClick={(event) => {
                        if ((event.target as HTMLElement).closest("a")) {
                            setMenuOpen(false);
                        }
                    }}
                >
                    {SECTIONS.map((section) => (
                        <a key={section.href} href={section.href}>
                            {section.label}
                        </a>
                    ))}
                    <Link to="/login">Anmelden</Link>
                    <Link className={`${styles.btn} ${styles.btnGo}`} to="/registrieren">
                        Firma registrieren
                    </Link>
                </nav>
            </header>

            <section
                ref={heroRef}
                className={styles.hero}
                aria-labelledby="landing-title"
            >
                <HeroMapCanvas className={styles.heroCanvas} />
                <div className={`${styles.wrap} ${styles.heroInner}`}>
                    <span className={styles.label}>Flottenleitstelle für Disponenten</span>
                    <h1 id="landing-title" className={styles.heroTitle}>
                        <span>Wer fährt.</span>
                        <span>Was steht.</span>
                        <span className={styles.mark}>Was fällig ist.</span>
                    </h1>
                    <p className={styles.heroLead}>
                        fleet-live bringt Fahrzeugstatus, Warnungen, Fristen und Fahrer auf einen
                        Schirm. Sie sehen in der ersten Minute der Schicht, was zu tun ist, und
                        arbeiten es von dort aus ab.
                    </p>
                    <div className={styles.cta}>
                        <Link className={`${styles.btn} ${styles.btnGo}`} to="/registrieren">
                            Firma registrieren
                        </Link>
                        <a className={`${styles.btn} ${styles.btnLine}`} href="#schicht">
                            Eine Schicht ansehen
                        </a>
                    </div>
                    <ul className={styles.statusStrip} aria-label="Beispiel: Fahrzeugstatus einer Flotte">
                        {(
                            [
                                ["86", "Auf Fahrt", "var(--l-go)"],
                                ["41", "Standby", "var(--l-idle)"],
                                ["23", "Feierabend", "var(--l-off)"],
                                ["3", "Kein Signal", "var(--l-lost)"],
                            ] as const
                        ).map(([value, name, color]) => (
                            <li key={name}>
                                <b>{value}</b>
                                <span style={{ "--c": color } as CSSProperties}>{name}</span>
                            </li>
                        ))}
                    </ul>
                    <p className={styles.sample}>Beispieldaten · Karte als Illustration der Flottenansicht</p>
                </div>
            </section>

            <section className={styles.block} id="schicht" aria-labelledby="schicht-titel">
                <div className={styles.wrap}>
                    <div className={styles.blockHead}>
                        <div>
                            <span className={styles.label}>Beispiel einer Frühschicht</span>
                            <h2 id="schicht-titel">Eine Schicht in fleet-live</h2>
                        </div>
                        <p>
                            Was in den ersten Stunden passiert und wo es in der App landet. Die
                            Uhrzeiten sind ein Beispiel, die Abläufe sind die der Anwendung.
                        </p>
                    </div>
                    <ol className={styles.shift}>
                        <li className={styles.step}>
                            <time dateTime="06:00">06:00</time>
                            <div className={styles.stepText}>
                                <h3>Lage erfassen</h3>
                                <p>
                                    Die Startseite zählt offene Warnungen, Fahrzeuge nach Status und
                                    fällige Fristen. Jede Kachel öffnet genau die Liste, die sie zählt.
                                </p>
                                <span className={styles.where}>Schicht</span>
                            </div>
                            <div className={styles.frag} role="img" aria-label="Beispiel: Kennzahlen der Startseite">
                                <div className={styles.fragHead} aria-hidden="true">
                                    <span>Schicht</span>
                                    <span>Do 15.10.</span>
                                </div>
                                <div className={styles.tiles} aria-hidden="true">
                                    <div><small>Offen</small><b className={styles.r}>12</b></div>
                                    <div><small>Auf Fahrt</small><b className={styles.g}>86</b></div>
                                    <div><small>Wenig Tank</small><b className={styles.y}>9</b></div>
                                    <div><small>Überfällig</small><b className={styles.r}>4</b></div>
                                    <div><small>In 30 Tagen</small><b className={styles.y}>11</b></div>
                                    <div><small>Datum fehlt</small><b>6</b></div>
                                </div>
                            </div>
                        </li>
                        <li className={styles.step}>
                            <time dateTime="06:04">06:04</time>
                            <div className={styles.stepText}>
                                <h3>Warnungen abarbeiten</h3>
                                <p>
                                    Ein Fahrzeug war acht Sekunden über dem Streckenlimit, ein anderes
                                    meldet sich nicht mehr. Sie prüfen Fahrer und Ereignis und erledigen
                                    die Warnung in der Zeile.
                                </p>
                                <span className={styles.where}>Warnungen</span>
                            </div>
                            <Fragment
                                label="Beispiel: Warnungs-Inbox"
                                head="Warnungen · offen"
                                count="12"
                                columns="1.2fr auto 1.4fr"
                                rows={[
                                    { lead: "HB-HV 0007", sub: "Lisa Müller", tag: ["Tempo", "t"], detail: "138 km/h · Limit 100" },
                                    { lead: "D-JB 0009", sub: "kein Fahrer", tag: ["Kein Signal", "f"], detail: "keine Meldung" },
                                    { lead: "K-AA 0104", sub: "Clara Schneider", tag: ["Tank", "k"], detail: "Tankstand 5 %" },
                                ]}
                            />
                        </li>
                        <li className={styles.step}>
                            <time dateTime="07:30">07:30</time>
                            <div className={styles.stepText}>
                                <h3>Besetzung klären</h3>
                                <p>
                                    Ein Fahrer übernimmt ein anderes Fahrzeug. Freigegeben ist er für
                                    mehrere, aktuell sitzt er in genau einem. Während einer Fahrt bleibt
                                    die Besetzung gesperrt.
                                </p>
                                <span className={styles.where}>Fahrer</span>
                            </div>
                            <Fragment
                                label="Beispiel: Fahrzeuge eines Fahrers"
                                head="Ben Arslan · Fahrzeuge"
                                count="3"
                                columns="1fr auto"
                                rows={[
                                    { lead: "HH-FN 1218", sub: "Standby", tag: ["Aktuell", "cur"] },
                                    { lead: "HH-KE 0036", sub: "Feierabend", tag: ["Freigegeben", "f"] },
                                    { lead: "HH-FN 2618", sub: "Standby", tag: ["Freigegeben", "f"] },
                                ]}
                            />
                        </li>
                        <li className={styles.step}>
                            <time dateTime="09:15">09:15</time>
                            <div className={styles.stepText}>
                                <h3>Fristen vorziehen</h3>
                                <p>
                                    Zwei HU-Termine laufen diesen Monat ab, bei einem Fahrer fehlt die
                                    Führerscheinkontrolle. Fristen zeigt beides, sortiert nach dem, was
                                    zuerst dran ist.
                                </p>
                                <span className={styles.where}>Fristen</span>
                            </div>
                            <Fragment
                                label="Beispiel: überfällige Fristen"
                                head="Fristen · überfällig"
                                count="4"
                                columns="1fr auto 80px"
                                rows={[
                                    { lead: "HB-TF 0175", tag: ["HU", "k"], detail: "09.2026" },
                                    { lead: "M-GS 0162", tag: ["HU", "k"], detail: "10.2026" },
                                    { lead: "Ali Arslan", tag: ["Kontrolle", "f"], detail: "fehlt" },
                                ]}
                            />
                        </li>
                        <li className={styles.step}>
                            <time dateTime="13:45">13:45</time>
                            <div className={styles.stepText}>
                                <h3>Übergabe vorbereiten</h3>
                                <p>
                                    Erledigte Warnungen bleiben nachvollziehbar. Für die Auswertung laden
                                    Sie Fahrzeuge, Warnungen, Fahrten oder den Monatsbericht als CSV.
                                </p>
                                <span className={styles.where}>Export</span>
                            </div>
                            <Fragment
                                label="Beispiel: Exportmenü"
                                head="Exportieren"
                                count="CSV"
                                columns="1fr auto"
                                rows={[
                                    { lead: "Fahrzeuge", detail: "Stammdaten" },
                                    { lead: "Warnungen", detail: "offen und erledigt" },
                                    { lead: "Monat", detail: "km, Warnungen, Verbrauch" },
                                ]}
                            />
                        </li>
                    </ol>
                </div>
            </section>

            <section className={styles.block} id="signale" aria-labelledby="signale-titel">
                <div className={styles.wrap}>
                    <div className={styles.blockHead}>
                        <div>
                            <span className={styles.label}>Eine Sprache für alle Ansichten</span>
                            <h2 id="signale-titel">Signale, die man nicht lesen muss</h2>
                        </div>
                        <p>
                            Karte, Listen und Detailseiten nutzen dieselben Farben und Begriffe. Was
                            rot ist, braucht Sie jetzt.
                        </p>
                    </div>
                    <div className={styles.signals}>
                        {(
                            [
                                ["var(--l-go)", "Auf Fahrt", "Das Fahrzeug meldet Position und Tempo. Die Fahrt wird als Strecke aufgezeichnet."],
                                ["var(--l-idle)", "Standby", "Bereit, aber nicht unterwegs. Oft am Depot."],
                                ["var(--l-off)", "Feierabend", "Abgestellt. Die letzte Position bleibt sichtbar."],
                                ["var(--l-lost)", "Kein Signal", "Keine Meldungen mehr. Daraus wird eine Warnung."],
                            ] as const
                        ).map(([color, name, text]) => (
                            <div key={name} className={styles.signal} style={{ "--c": color } as CSSProperties}>
                                <i aria-hidden="true" />
                                <h3>{name}</h3>
                                <p>{text}</p>
                            </div>
                        ))}
                    </div>
                    <div className={styles.speed}>
                        <div className={styles.gauge} aria-hidden="true">
                            138<small>km/h</small>
                        </div>
                        <p>
                            Tempo wird orange, sobald ein Fahrzeug über dem Limit seines
                            Streckenabschnitts liegt. Hält das acht Sekunden an, entsteht eine
                            Tempo-Warnung und die Zahl wird rot, bis die Überschreitung endet.
                        </p>
                        <div className={styles.scale} aria-hidden="true">
                            <span />
                            <span />
                            <span />
                        </div>
                        <div className={styles.legend} aria-hidden="true">
                            <span>im Rahmen</span>
                            <span>über dem Limit</span>
                            <span>Warnung offen</span>
                        </div>
                    </div>
                </div>
            </section>

            <section className={styles.block} id="einrichten" aria-labelledby="einrichten-titel">
                <div className={styles.wrap}>
                    <div className={styles.blockHead}>
                        <div>
                            <span className={styles.label}>Für die ganze Firma</span>
                            <h2 id="einrichten-titel">Einrichten und Zugang</h2>
                        </div>
                        <p>
                            Eine Firma registriert sich selbst, bringt ihre Stammdaten mit und
                            entscheidet, wer was ändern darf.
                        </p>
                    </div>
                    <div className={styles.split}>
                        <ol className={styles.setup}>
                            <li>
                                <div>
                                    <h3>Firma registrieren</h3>
                                    <p>Firmenname, Name und E-Mail. Nach der Bestätigung per Link sind Sie der erste Dispatcher.</p>
                                </div>
                            </li>
                            <li>
                                <div>
                                    <h3>Stammdaten importieren</h3>
                                    <p>Fahrzeuge, Fahrer, Freigaben und Besetzung aus CSV oder Excel, mit Vorschau vor dem Übernehmen.</p>
                                </div>
                            </li>
                            <li>
                                <div>
                                    <h3>Team einladen</h3>
                                    <p>Weitere Dispatcher oder Lesezugriffe per E-Mail einladen.</p>
                                </div>
                            </li>
                        </ol>
                        <div className={styles.access}>
                            <div>
                                <h3>Dispatcher und Lesezugriff</h3>
                                <p>Dispatcher ändern Daten und erledigen Warnungen. Lesezugriff sieht dieselben Seiten und ändert nichts.</p>
                            </div>
                            <div>
                                <h3>Zwei-Faktor und Firmen-Login</h3>
                                <p>Authenticator-App, Google, Microsoft oder der eigene OIDC-Anbieter. Die Firma kann beides für alle verlangen.</p>
                            </div>
                            <div>
                                <h3>Mehrere Firmen, getrennte Daten</h3>
                                <p>Wer für mehrere Firmen arbeitet, wechselt zwischen ihnen. Jede sieht nur ihre eigenen Fahrzeuge.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className={styles.block} id="fragen" aria-labelledby="fragen-titel">
                <div className={styles.wrap}>
                    <div className={styles.blockHead}>
                        <div>
                            <span className={styles.label}>Kurz beantwortet</span>
                            <h2 id="fragen-titel">Fragen</h2>
                        </div>
                    </div>
                    <div className={styles.faq}>
                        <details>
                            <summary>Woher kommen die Positionen?</summary>
                            <p>
                                In der aktuellen Version aus einem eingebauten Simulator, der Fahrzeuge
                                auf festen Routen zwischen Städten fahren lässt. Eine Anbindung von
                                Telematik-Hardware ist nicht Teil dieser Version.
                            </p>
                        </details>
                        <details>
                            <summary>Können wir unsere Listen übernehmen?</summary>
                            <p>
                                Ja, als CSV oder Excel. Die Vorschau zeigt vor dem Übernehmen, was
                                angelegt, was aktualisiert und was übersprungen wird. Die
                                Spaltenzuordnung bleibt für den nächsten Import gespeichert.
                            </p>
                        </details>
                        <details>
                            <summary>Läuft das auch auf dem Handy?</summary>
                            <p>
                                Die Oberfläche läuft im Browser und passt sich kleinen Bildschirmen an,
                                mit Menü und Kartenansicht für unterwegs.
                            </p>
                        </details>
                        <details>
                            <summary>Was passiert mit erledigten Warnungen?</summary>
                            <p>
                                Sie verschwinden aus „Offen“ und bleiben unter „Erledigt“ sichtbar. Am
                                Fahrer bleibt die Tempo-Historie erhalten.
                            </p>
                        </details>
                    </div>
                </div>
            </section>

            <section className={styles.closing} aria-labelledby="schluss-titel">
                <div className={styles.wrap}>
                    <span className={styles.label}>Bereit für die nächste Schicht</span>
                    <h2 id="schluss-titel">Die Lage auf einen Blick.</h2>
                    <p>
                        Registrieren Sie Ihre Firma und importieren Sie Ihre Fahrzeuge. Mit
                        bestehendem Konto melden Sie sich direkt an.
                    </p>
                    <div className={styles.cta}>
                        <Link className={`${styles.btn} ${styles.btnGo}`} to="/registrieren">
                            Firma registrieren
                        </Link>
                        <Link className={`${styles.btn} ${styles.btnLine}`} to="/login">
                            Anmelden
                        </Link>
                    </div>
                </div>
            </section>

            <footer className={styles.footer}>
                <div className={`${styles.wrap} ${styles.foot}`}>
                    <Link className={styles.brand} to="/">
                        fleet-live <small>Leitstelle</small>
                    </Link>
                    <nav aria-label="Fußzeile">
                        {SECTIONS.map((section) => (
                            <a key={section.href} href={section.href}>
                                {section.label}
                            </a>
                        ))}
                        <Link to="/login">Anmelden</Link>
                        <Link to="/passwort-vergessen">Passwort vergessen</Link>
                    </nav>
                </div>
            </footer>
        </div>
    );
};
