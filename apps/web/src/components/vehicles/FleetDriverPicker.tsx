import { FLEET_DRIVERS_MAX } from "@fleet-live/shared";

import { useFleetDriverFilter } from "../../hooks/useFleetDriverFilter";
import { formatCount } from "../../utils/formatCount";
import { Button } from "../ui/Button/Button";
import { Checkbox } from "../ui/Checkbox/Checkbox";
import { Input } from "../ui/Input/Input";
import { Modal } from "../ui/Modal/Modal";
import { TablePagination } from "../ui/Table/TablePagination";
import styles from "./FleetDriverPicker.module.scss";

type FleetDriverPickerProps = {
    selected: string[];
    onChange: (names: string[]) => void;
    /** Text filter that stands for every matching driver ("" = none). */
    searchText?: string;
    onSearchText?: (text: string) => void;
};

export const FleetDriverPicker = ({
    selected,
    onChange,
    searchText = "",
    onSearchText = () => undefined,
}: FleetDriverPickerProps) => {
    const {
        open,
        openModal,
        closeModal,
        draft,
        setDraft,
        query,
        setQuery,
        visible,
        rosterTotal,
        matched,
        page,
        setPage,
        pageCount,
        searchRef,
        listRef,
        searching,
        searchPending,
        toggle,
        applySearchText,
        apply,
    } = useFleetDriverFilter({
        selected,
        onChange,
        searchText,
        onSearchText,
    });

    const label =
        searchText.length > 0
            ? `Suche „${searchText}“`
            : selected.length === 0
            ? "Fahrer filtern"
            : selected.length === 1
              ? selected[0]
              : `${formatCount(selected.length)} Fahrer`;
    const triggerLabel =
        searchText.length > 0
            ? `Fahrer: Suche „${searchText}“`
            : selected.length === 0
            ? "Fahrer filtern"
            : selected.length === 1
              ? `Fahrer: ${selected[0]}`
              : `${formatCount(selected.length)} Fahrer ausgewählt`;
    // Turning a page keeps the old rows, the count and the pager on screen until
    // the next page is there; only a first search shows "Suche…".
    const firstSearch = searchPending && matched === 0;
    const summary = searching
        ? firstSearch
            ? "Suche…"
            : `${formatCount(matched)} Treffer`
        : draft.length > 0
          ? `${formatCount(draft.length)} ausgewählt`
          : rosterTotal > 0
            ? `${formatCount(rosterTotal)} Fahrer — Name oder Kennzeichen suchen.`
            : "Name oder Kennzeichen suchen.";

    return (
        <div className={styles.wrap}>
            <button
                type="button"
                className={styles.trigger}
                data-tip="fleet-drivers"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={triggerLabel}
                data-filled={selected.length > 0 || searchText.length > 0 ? "true" : undefined}
                onClick={openModal}
            >
                <span className={styles.triggerText}>{label}</span>
                <span className={styles.caret} aria-hidden>
                    ▾
                </span>
            </button>

            <Modal
                open={open}
                onClose={closeModal}
                title="Fahrer auswählen"
                size="lg"
            >
                <div className={styles.modal}>
                    <div className={styles.toolbar}>
                        <Input
                            ref={searchRef}
                            type="search"
                            size="md"
                            fullWidth
                            placeholder="Name oder Kennzeichen"
                            aria-label="Name oder Kennzeichen"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                        />
                        <p className={styles.summary}>
                            {summary}
                            {draft.length >= FLEET_DRIVERS_MAX
                                ? ` · höchstens ${FLEET_DRIVERS_MAX}`
                                : ""}
                        </p>
                    </div>

                    <ul ref={listRef} className={styles.list}>
                        {visible.map((driver) => {
                            const checked = draft.includes(driver.name);
                            const blocked =
                                !checked &&
                                draft.length >= FLEET_DRIVERS_MAX;

                            return (
                                <li key={`${driver.name}:${driver.license_plate}`}>
                                    <label
                                        className={
                                            checked
                                                ? `${styles.option} ${styles.optionChecked}`
                                                : styles.option
                                        }
                                    >
                                        <Checkbox
                                            checked={checked}
                                            disabled={blocked}
                                            onChange={() =>
                                                toggle(driver.name)
                                            }
                                        />
                                        <span className={styles.name}>
                                            {driver.name}
                                        </span>
                                        <span className={styles.plate}>
                                            {driver.license_plate || "—"}
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                    {searching &&
                        !searchPending &&
                        visible.length === 0 && (
                            <p className={styles.empty}>
                                Keine Fahrer gefunden.
                            </p>
                        )}
                    {!searching && draft.length === 0 && (
                        <p className={styles.empty}>
                            Ein Fahrer sitzt in einem Fahrzeug. Name
                            oder Kennzeichen eingeben, dann in der
                            Liste auswählen.
                        </p>
                    )}
                    {searching && !firstSearch && pageCount > 1 && (
                        <div className={styles.pager}>
                            <TablePagination
                                compact
                                page={page}
                                pageCount={pageCount}
                                total={matched}
                                disabled={searchPending}
                                onPageChange={setPage}
                            />
                        </div>
                    )}
                    <div className={styles.footer}>
                        <div className={styles.selectActions}>
                            {searching && !firstSearch && matched > 0 && (
                                <Button
                                    variant="secondary"
                                    size="md"
                                    onClick={applySearchText}
                                >
                                    {matched === 1
                                        ? "Treffer filtern"
                                        : `Alle ${formatCount(matched)} Treffer filtern`}
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                size="md"
                                disabled={draft.length === 0 && searchText.length === 0}
                                onClick={() => {
                                    setDraft([]);
                                    onSearchText("");
                                }}
                            >
                                Auswahl aufheben
                            </Button>
                        </div>
                        <div className={styles.actions}>
                            <Button
                                type="button"
                                variant="secondary"
                                size="md"
                                onClick={closeModal}
                            >
                                Abbrechen
                            </Button>
                            <Button
                                type="button"
                                variant="primary"
                                size="md"
                                onClick={apply}
                            >
                                Übernehmen
                            </Button>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
};
