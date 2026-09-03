import { FLEET_DRIVERS_MAX } from "@fleet-live/shared";

import { useAssignmentPicker } from "../../hooks/useAssignmentPicker";
import { formatCount } from "../../utils/formatCount";
import { Button } from "../ui/Button/Button";
import { Modal } from "../ui/Modal/Modal";
import styles from "./FleetDriverPicker.module.scss";

type FleetDriverPickerProps = {
    selected: string[];
    onChange: (names: string[]) => void;
};

export const FleetDriverPicker = ({
    selected,
    onChange,
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
        apply,
    } = useAssignmentPicker({
        mode: "fleet-filter",
        selected,
        onChange,
    });

    const label =
        selected.length === 0
            ? "Fahrer filtern"
            : selected.length === 1
              ? selected[0]
              : `${formatCount(selected.length)} Fahrer`;
    const triggerLabel =
        selected.length === 0
            ? "Fahrer filtern"
            : selected.length === 1
              ? `Fahrer: ${selected[0]}`
              : `${formatCount(selected.length)} Fahrer ausgewählt`;
    const summary = searching
        ? searchPending
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
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={triggerLabel}
                data-filled={selected.length > 0 ? "true" : undefined}
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
                        <input
                            ref={searchRef}
                            type="search"
                            className={styles.search}
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
                                        <input
                                            type="checkbox"
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
                    <div className={styles.footer}>
                        <button
                            type="button"
                            className={styles.clear}
                            disabled={draft.length === 0}
                            onClick={() => setDraft([])}
                        >
                            Auswahl aufheben
                        </button>
                        {searching && !searchPending && pageCount > 1 && (
                            <div className={styles.pager}>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={page <= 1}
                                    onClick={() => setPage(page - 1)}
                                >
                                    Zurück
                                </Button>
                                <span>
                                    Seite {formatCount(page)} von{" "}
                                    {formatCount(pageCount)}
                                </span>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={page >= pageCount}
                                    onClick={() => setPage(page + 1)}
                                >
                                    Weiter
                                </Button>
                            </div>
                        )}
                        <div className={styles.actions}>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={closeModal}
                            >
                                Abbrechen
                            </Button>
                            <Button
                                type="button"
                                variant="primary"
                                size="sm"
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
