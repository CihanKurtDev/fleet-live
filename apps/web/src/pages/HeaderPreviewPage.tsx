import header from "../components/AppHeader.module.scss";
import styles from "./HeaderPreviewPage.module.scss";

const ProposedHeader = ({
    variant,
}: {
    variant: "dispatcher" | "viewer";
}) => (
    <header className={header.header}>
        <div className={header.start}>
            <span className={header.brand}>fleet-live</span>
            <nav className={header.nav} aria-label="Hauptnavigation">
                <span className={`${header.navItem} ${header.navItemActive}`}>
                    Fahrzeuge
                </span>
                <span className={header.navItem}>Karte</span>
                <span className={header.navItem}>
                    Warnungen
                    <span className={header.badge}>12</span>
                </span>
                <span className={header.navItem}>Fahrer</span>
            </nav>
        </div>
        <div className={header.end}>
            {variant === "dispatcher" ? (
                <span className={header.fakeButton}>Simulation pausieren</span>
            ) : null}
            <div className={header.session}>
                <span>Anna Dispatcher</span>
                <span className={header.fakeButton}>Abmelden</span>
            </div>
        </div>
    </header>
);

export const HeaderPreviewPage = () => (
    <section className={styles.page}>
        <h1 className={styles.title}>Header-Vorschau</h1>
        <p className={styles.lead}>
            Isoliertes Layout, keine echte Navigation. Brand und Nav teilen
            eine 32px-Zeile (Schrift 24px Zeilenhöhe). Rechts stehen Simulator
            und Sitzung als eine Gruppe.
        </p>

        <h2 className={styles.heading}>Dispatcher</h2>
        <div className={styles.frame}>
            <ProposedHeader variant="dispatcher" />
        </div>

        <h2 className={styles.heading}>Viewer</h2>
        <div className={styles.frame}>
            <ProposedHeader variant="viewer" />
        </div>

        <h2 className={styles.heading}>Schmale Breite (480px)</h2>
        <div className={`${styles.frame} ${styles.narrow}`}>
            <ProposedHeader variant="dispatcher" />
        </div>
    </section>
);
