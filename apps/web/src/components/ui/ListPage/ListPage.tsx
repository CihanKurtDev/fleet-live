/**
 * The list page frame (`rules/design-system.md`): header, KPI tiles
 * (`ui/KpiTiles`), one list panel with toolbar or selection bar, body and
 * footer. Fahrzeuge, Warnungen and Fahrer compose these pieces:
 *
 * ```tsx
 * <ListPage selecting={selection.active}>
 *     <ListPageHeader title="…" summary="…" notice={notice} actions={…} />
 *     <KpiTiles ariaLabel="…" phoneLayout="strip" tiles={…} />
 *     <ListPanel label="…">
 *         {selection.active ? <SelectionBar … /> : <ListToolbar … />}
 *         <ListBody ref={pageSizeRef}><Table selectionMode={…} … /></ListBody>
 *         <ListFooter … />
 *     </ListPanel>
 * </ListPage>
 * ```
 */
import { useEffect, useRef, type ReactNode, type Ref } from "react";

import { skipMotion } from "../../../hooks/usePresence";
import { Button } from "../Button/Button";
import { Checkbox } from "../Checkbox/Checkbox";
import { Input } from "../Input/Input";
import { TablePagination } from "../Table/TablePagination";
import { usePageTitle } from "../../../hooks/usePageTitle";
import styles from "./ListPage.module.scss";

interface ListPageProps {
    children: ReactNode;
    /** Selection mode is on (phones keep room for the bottom bar). */
    selecting?: boolean;
    /** A refetch is running: the body dims a little. */
    busy?: boolean;
}

/** Page root. From 701 px it fills the window; the panel takes the rest. */
export const ListPage = ({ children, selecting = false, busy = false }: ListPageProps) => (
    <section
        className={busy ? `${styles.page} ${styles.busy}` : styles.page}
        data-selecting={selecting ? "true" : undefined}
    >
        {children}
    </section>
);

interface ListPageHeaderProps {
    /** h1, 34 px. */
    title: string;
    /** One muted sentence about the situation. */
    summary?: ReactNode;
    /**
     * Short feedback after an action ("3 Fahrzeuge gelöscht."). The
     * `role="status"` line is always rendered so it is announced.
     */
    notice?: string | null;
    /** Dispatcher actions, primary action last. Viewers pass nothing. */
    actions?: ReactNode;
}

export const ListPageHeader = ({
    title,
    summary,
    notice,
    actions,
}: ListPageHeaderProps) => {
    const noticeRef = useRef<HTMLParagraphElement>(null);
    usePageTitle(title);

    // Each new confirmation rises in; the live region itself stays in place.
    useEffect(() => {
        const element = noticeRef.current;

        if (
            !notice ||
            !element ||
            typeof element.animate !== "function" ||
            skipMotion()
        ) {
            return;
        }

        element.animate(
            [
                { opacity: 0, transform: "translateY(6px)" },
                { opacity: 1, transform: "none" },
            ],
            { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
    }, [notice]);

    return (
        <header className={styles.header}>
            <div className={styles.heading}>
                <h1 className={styles.title}>{title}</h1>
                {/* The line is kept while loading, so the tiles below do not jump. */}
                <p
                    className={styles.summary}
                    aria-hidden={summary ? undefined : true}
                >
                    {summary || "\u00a0"}
                </p>
            </div>
            <p
                ref={noticeRef}
                className={styles.notice}
                role="status"
                aria-live="polite"
            >
                {notice}
            </p>
            {actions && <div className={styles.actions}>{actions}</div>}
        </header>
    );
};

interface ListPanelProps {
    /** Spoken name of the list region. */
    label: string;
    children: ReactNode;
}

/** The one bordered panel; fills the remaining height. */
export const ListPanel = ({ label, children }: ListPanelProps) => (
    <section className={styles.panel} aria-label={label}>
        {children}
    </section>
);

type ListSearch = {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    ariaLabel: string;
};

interface ListToolbarProps {
    /** Shows "Auswählen" first. Only where a bulk action exists, dispatchers only. */
    onStartSelection?: () => void;
    /** Further filters as menus (`ui/Menu/MenuButton`). */
    filters?: ReactNode;
    /** Search field, right-aligned. */
    search?: ListSearch;
}

/** 54 px toolbar: Auswählen, filters, search right. */
export const ListToolbar = ({
    onStartSelection,
    filters,
    search,
}: ListToolbarProps) => (
    <div className={styles.toolbar}>
        {onStartSelection && (
            <Button
                variant="secondary"
                size="toolbar"
                data-tip="list-select"
                onClick={onStartSelection}
            >
                Auswählen
            </Button>
        )}
        {filters}
        {search && (
            <Input
                type="search"
                size="sm"
                className={styles.search}
                data-tip="list-search"
                placeholder={search.placeholder}
                aria-label={search.ariaLabel}
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
            />
        )}
    </div>
);

type PageCheckbox = {
    checked: boolean;
    indeterminate: boolean;
    disabled?: boolean;
    onChange: () => void;
};

interface SelectionBarProps {
    /** Selected rows. */
    count: number;
    /** Checkbox for all rows on this page (`useSelectionMode().pageCheckbox`). */
    pageCheckbox: PageCheckbox;
    pageCheckboxLabel?: string;
    /** Optional muted text after "N ausgewählt". */
    summary?: ReactNode;
    /** Bulk actions, e.g. `<Button variant="dangerOutline" size="toolbar">`. */
    actions?: ReactNode;
    /** "Abbrechen" and Escape: leave selection mode. */
    onDone: () => void;
}

/**
 * Replaces the toolbar in selection mode. On phones it sits at the bottom
 * of the screen. Escape ends the mode unless a dialog or menu takes it.
 */
export const SelectionBar = ({
    count,
    pageCheckbox,
    pageCheckboxLabel = "Alle auf dieser Seite auswählen",
    summary,
    actions,
    onDone,
}: SelectionBarProps) => {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (
                event.key !== "Escape" ||
                event.defaultPrevented ||
                document.querySelector("dialog[open]")
            ) {
                return;
            }

            onDone();
        };

        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [onDone]);

    return (
        <div className={styles.selectionBar} role="region" aria-label="Auswahl">
            <Checkbox
                checked={pageCheckbox.checked}
                indeterminate={pageCheckbox.indeterminate}
                disabled={pageCheckbox.disabled}
                onChange={pageCheckbox.onChange}
                aria-label={pageCheckboxLabel}
            />
            <p className={styles.selectionText}>
                <strong className={styles.selectionCount}>
                    {count} ausgewählt
                </strong>
                {summary && (
                    <span className={styles.selectionSummary}>{summary}</span>
                )}
            </p>
            <div className={styles.selectionActions}>
                {actions}
                <Button variant="secondary" size="toolbar" onClick={onDone}>
                    Abbrechen
                </Button>
            </div>
        </div>
    );
};

interface ListBodyProps {
    /** From `useListPageSize`; measures the rows that fit. */
    ref?: Ref<HTMLDivElement>;
    children: ReactNode;
}

/**
 * Holds the table: header row 38 px, rows 48 px. From 701 px it takes the
 * panel's remaining height and is measured; on phones it grows.
 */
export const ListBody = ({ ref, children }: ListBodyProps) => (
    <div ref={ref} className={styles.body}>
        {children}
    </div>
);

interface ListFooterProps {
    page: number;
    pageCount: number;
    /** Rows per page (the measured page size). */
    limit: number;
    total: number;
    onPageChange: (page: number) => void;
    /** Without rows the footer keeps its height and stays empty. */
    show?: boolean;
}

/** 48 px footer: "X–Y von N" left, pages right. */
export const ListFooter = ({
    page,
    pageCount,
    limit,
    total,
    onPageChange,
    show = true,
}: ListFooterProps) => (
    <footer className={styles.footer}>
        {show && total > 0 && (
            <TablePagination
                layout="footer"
                page={page}
                pageCount={pageCount}
                limit={limit}
                total={total}
                onPageChange={onPageChange}
            />
        )}
    </footer>
);

interface ListEmptyProps {
    message: string;
    /** Shown as "Filter aufheben" while a filter or search is active. */
    onClearFilters?: () => void;
}

/** Empty list: one line, plus "Filter aufheben" when a filter is active. */
export const ListEmpty = ({ message, onClearFilters }: ListEmptyProps) => (
    <div className={styles.empty}>
        <p>{message}</p>
        {onClearFilters && (
            <Button variant="secondary" size="row" onClick={onClearFilters}>
                Filter aufheben
            </Button>
        )}
    </div>
);
