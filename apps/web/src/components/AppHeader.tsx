import {
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { Link, NavLink, useLocation } from "react-router";
import { SimToggle } from "./SimToggle";
import { SessionMenu } from "./SessionMenu";
import { CompanySwitch } from "./CompanySwitch";
import { Button } from "./ui/Button/Button";
import { useAuth } from "../hooks/useAuth";
import { useLogout } from "../hooks/useLogout";
import { useVehicles } from "../context/vehiclesContext";
import { formatCount } from "../utils/formatCount";
import styles from "./AppHeader.module.scss";

type NavItem = {
    to: string;
    label: string;
    ariaLabel?: string;
    /** Only in the phone drawer; on desktop the brand and the name link there. */
    drawerOnly?: boolean;
    badge?: boolean;
};

const NAV_ITEMS: NavItem[] = [
    { to: "/", label: "Schicht", drawerOnly: true },
    { to: "/vehicles", label: "Fahrzeuge" },
    { to: "/fleet", label: "Karte", ariaLabel: "Flottenkarte" },
    { to: "/alerts", label: "Warnungen", badge: true },
    { to: "/fristen", label: "Fristen" },
    { to: "/drivers", label: "Fahrer" },
    { to: "/konto", label: "Konto", drawerOnly: true },
];

const isInSection = (pathname: string, to: string) =>
    to === "/"
        ? pathname === "/"
        : pathname === to || pathname.startsWith(`${to}/`);

const sectionTitle = (pathname: string) =>
    NAV_ITEMS.find((item) => isInSection(pathname, item.to))?.label ??
    "fleet-live";

const navClassName = ({ isActive }: { isActive: boolean }) =>
    isActive ? styles.active : undefined;

/** Small live dot for the phone bar. Shown only while the SSE stream is up. */
export const HeaderLiveStatus = () => {
    const { streamConnection } = useVehicles();

    if (streamConnection !== "live") {
        return null;
    }

    return (
        <span className={styles.live} role="status">
            <span className={styles.liveDot} aria-hidden="true" />
            Live
        </span>
    );
};

export const AppHeader = ({
    openAlertCount,
    status,
}: {
    openAlertCount?: number;
    /** Right side of the phone bar, e.g. `HeaderLiveStatus`. */
    status?: ReactNode;
}) => {
    const { user } = useAuth();
    const handleLogout = useLogout();
    const { pathname } = useLocation();
    const drawerId = useId();
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const drawerRef = useRef<HTMLDivElement>(null);
    // The menu belongs to the page it was opened on, so navigating closes it.
    const [menuPath, setMenuPath] = useState<string | null>(null);
    const menuOpen = user !== null && menuPath === pathname;

    const closeMenu = useCallback(() => {
        setMenuPath(null);
        menuButtonRef.current?.focus();
    }, []);

    useEffect(() => {
        if (!menuOpen) {
            return;
        }

        drawerRef.current?.querySelector<HTMLElement>("nav a")?.focus();

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                closeMenu();
            }
        };

        document.addEventListener("keydown", onKeyDown);

        return () => document.removeEventListener("keydown", onKeyDown);
    }, [menuOpen, closeMenu]);

    const alertBadge =
        openAlertCount !== undefined && openAlertCount > 0 ? (
            <span className={styles.badge}>{formatCount(openAlertCount)}</span>
        ) : null;

    return (
        <>
            <header
                className={
                    user ? `${styles.header} ${styles.authed}` : styles.header
                }
            >
                <div className={styles.bar}>
                    <div className={styles.start}>
                        <Link
                            className={styles.brand}
                            to={user ? "/" : "/login"}
                        >
                            fleet-live
                        </Link>
                        {user && (
                            <nav
                                className={styles.nav}
                                aria-label="Hauptnavigation"
                            >
                                {NAV_ITEMS.filter(
                                    (item) => !item.drawerOnly,
                                ).map((item) => (
                                    <NavLink
                                        key={item.to}
                                        to={item.to}
                                        aria-label={item.ariaLabel}
                                        className={navClassName}
                                    >
                                        {item.label}
                                        {item.badge ? alertBadge : null}
                                    </NavLink>
                                ))}
                            </nav>
                        )}
                    </div>
                    <div className={styles.end}>
                        {user && user.role === "dispatcher" && <SimToggle />}
                        <SessionMenu />
                    </div>
                </div>

                {user && (
                    <div className={styles.mobileBar}>
                        <button
                            ref={menuButtonRef}
                            type="button"
                            className={styles.menuButton}
                            aria-label={
                                menuOpen ? "Menü schließen" : "Menü öffnen"
                            }
                            aria-expanded={menuOpen}
                            aria-controls={drawerId}
                            onClick={() =>
                                menuOpen ? closeMenu() : setMenuPath(pathname)
                            }
                        >
                            <svg
                                viewBox="0 0 24 24"
                                width="18"
                                height="18"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                aria-hidden="true"
                            >
                                <path
                                    d={
                                        menuOpen
                                            ? "M18 6 6 18M6 6l12 12"
                                            : "M4 7h16M4 12h16M4 17h16"
                                    }
                                />
                            </svg>
                        </button>
                        <span className={styles.pageTitle}>
                            {sectionTitle(pathname)}
                        </span>
                        {status}
                    </div>
                )}
            </header>

            {menuOpen && user && (
                <>
                    <div
                        className={styles.backdrop}
                        aria-hidden="true"
                        onClick={closeMenu}
                    />
                    <div
                        ref={drawerRef}
                        id={drawerId}
                        className={styles.drawer}
                    >
                        <div className={styles.drawerHead}>
                            <span className={styles.drawerBrand}>
                                fleet-live
                            </span>
                            {user.memberships.length > 1 ? (
                                <>
                                    <CompanySwitch fullWidth />
                                    <span className={styles.drawerIdentity}>
                                        {user.name}
                                    </span>
                                </>
                            ) : (
                                <span className={styles.drawerIdentity}>
                                    {user.company_name} · {user.name}
                                </span>
                            )}
                        </div>

                        <nav
                            className={styles.drawerNav}
                            aria-label="Hauptnavigation"
                        >
                            {NAV_ITEMS.map((item) => (
                                <NavLink
                                    key={item.to}
                                    to={item.to}
                                    end={item.to === "/"}
                                    aria-label={item.ariaLabel}
                                    className={navClassName}
                                    onClick={closeMenu}
                                >
                                    {item.label}
                                    {item.badge ? alertBadge : null}
                                </NavLink>
                            ))}
                        </nav>

                        <div className={styles.drawerFoot}>
                            {user.role === "dispatcher" && (
                                <SimToggle fullWidth />
                            )}
                            <Button
                                variant="ghost"
                                fullWidth
                                className={styles.logout}
                                onClick={handleLogout}
                            >
                                Abmelden
                            </Button>
                        </div>
                    </div>
                </>
            )}
        </>
    );
};
