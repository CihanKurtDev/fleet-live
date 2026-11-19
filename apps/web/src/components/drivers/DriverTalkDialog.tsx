import { useState } from "react";
import { DRIVER_TALK_NOTE_MAX, berlinTodayIso } from "@fleet-live/shared";

import { talkToDriver } from "../../api/drivers";
import { formatIsoDate } from "../../utils/dateTime";
import { formatCount } from "../../utils/formatCount";
import { Button } from "../ui/Button/Button";
import { FieldError } from "../ui/FieldError/FieldError";
import { Textarea } from "../ui/Input/Textarea";
import { Modal } from "../ui/Modal/Modal";
import styles from "./DriverHintsPanel.module.scss";

interface DriverTalkDialogProps {
    /** The driver to enter a talk for; `null` closes the dialog. */
    driver: { id: number; name: string; open_warnings: number } | null;
    onClose: () => void;
    /** After the talk was saved: how many warnings it closed. */
    onDone: (resolved: number) => void;
}

/** „Gespräch geführt“: closes all open Tempo warnings of a driver with a note. */
export const DriverTalkDialog = ({ driver, onClose, onDone }: DriverTalkDialogProps) => {
    const [note, setNote] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const open = driver?.open_warnings ?? 0;
    const close = () => {
        setNote("");
        setError(null);
        onClose();
    };

    const confirm = async () => {
        if (!driver) {
            return;
        }

        setBusy(true);
        setError(null);

        try {
            const { data } = await talkToDriver(driver.id, note.trim() === "" ? null : note.trim());
            setNote("");
            onDone(data.resolved);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Nicht gespeichert.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal open={driver !== null} onClose={close} title="Gespräch geführt?">
            <div className={styles.talk}>
                <p>
                    Erledigt {open === 1 ? "1 offene Tempo-Warnung" : `${formatCount(open)} offene Tempo-Warnungen`} von{" "}
                    {driver?.name} mit dem Vermerk „Gespräch geführt am {formatIsoDate(berlinTodayIso())}“.
                </p>
                <label htmlFor="driver-talk-note">Notiz (freiwillig)</label>
                <Textarea
                    id="driver-talk-note"
                    rows={2}
                    maxLength={DRIVER_TALK_NOTE_MAX}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                />
                <FieldError fieldId="driver-talk-note">{error}</FieldError>
                <div className={styles.talkActions}>
                    <Button type="button" variant="secondary" size="md" onClick={close}>
                        Abbrechen
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        size="md"
                        busy={busy}
                        busyLabel="Wird gespeichert…"
                        onClick={() => void confirm()}
                    >
                        {formatCount(open)} erledigen
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
