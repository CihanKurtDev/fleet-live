import { useId, useState, type FormEvent } from "react";
import {
    WORKSHOP_NOTE_MAX,
    WORKSHOP_REASON_LABELS,
    berlinTodayIso,
    type WorkshopVisit,
} from "@fleet-live/shared";

import { ApiError } from "../../api/client";
import { finishWorkshopVisit } from "../../api/workshop";
import { formatIsoDate, formatYearMonth } from "../../utils/dateTime";
import { Button } from "../ui/Button/Button";
import { FieldError } from "../ui/FieldError/FieldError";
import { fieldAria } from "../ui/FieldError/fieldAria";
import { Input } from "../ui/Input/Input";
import { Textarea } from "../ui/Input/Textarea";
import { Modal } from "../ui/Modal/Modal";
import formStyles from "./VehicleForm.module.scss";
import styles from "./workshop.module.scss";

type Field = "finished_on" | "cost" | "hu_due_on" | "result_note" | "form";

interface WorkshopFinishDialogProps {
    visit: WorkshopVisit | null;
    onClose: () => void;
    onSaved: (visit: WorkshopVisit, message: string) => void;
}

/** „Fertig melden“: the stay ends, an HU gets its new month. */
export const WorkshopFinishDialog = ({ visit, onClose, onSaved }: WorkshopFinishDialogProps) => (
    <Modal open={visit !== null} onClose={onClose} title="Fertig melden" guardUnsaved>
        {visit && (
            <FinishForm key={visit.id} visit={visit} onCancel={onClose} onSaved={onSaved} />
        )}
    </Modal>
);

const FinishForm = ({
    visit,
    onCancel,
    onSaved,
}: {
    visit: WorkshopVisit;
    onCancel: () => void;
    onSaved: (visit: WorkshopVisit, message: string) => void;
}) => {
    const fieldId = useId();
    const today = berlinTodayIso();
    const isHu = visit.reason === "HU";
    const [finishedOn, setFinishedOn] = useState(today);
    const [cost, setCost] = useState("");
    const [huDueOn, setHuDueOn] = useState("");
    const [note, setNote] = useState("");
    const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const clear = (field: Field) =>
        setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (isHu && huDueOn === "") {
            setErrors({ hu_due_on: "Neue HU fällig fehlt." });
            return;
        }

        setIsSubmitting(true);
        setErrors({});

        try {
            const { data } = await finishWorkshopVisit(visit.id, {
                finished_on: finishedOn,
                cost,
                result_note: note,
                hu_due_on: isHu ? huDueOn : null,
            });
            onSaved(
                data,
                isHu
                    ? `${visit.license_plate} ist fertig. HU fällig ${formatYearMonth(huDueOn)}.`
                    : `${visit.license_plate} ist fertig und wieder einsatzbereit.`,
            );
        } catch (caught) {
            if (caught instanceof ApiError) {
                const fields = (caught.fields ?? {}) as Partial<Record<Field, string>>;
                const known = Object.keys(fields).length > 0;
                setErrors({ ...fields, form: known ? undefined : caught.message });
            } else {
                setErrors({ form: "Fertig melden hat nicht geklappt." });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const arrived = visit.arrived_on ?? visit.planned_on;

    return (
        <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
            <p className={styles.context}>
                {visit.license_plate} · {WORKSHOP_REASON_LABELS[visit.reason]} bei {visit.place},
                dort seit {formatIsoDate(arrived)}
            </p>

            <div className={styles.pair}>
                <div className={formStyles.field}>
                    <label htmlFor={`${fieldId}-finished`}>Fertig am</label>
                    <Input
                        id={`${fieldId}-finished`}
                        type="date"
                        size="md"
                        fullWidth
                        min={arrived}
                        max={today}
                        value={finishedOn}
                        onChange={(event) => {
                            setFinishedOn(event.target.value);
                            clear("finished_on");
                        }}
                        {...fieldAria(`${fieldId}-finished`, errors.finished_on)}
                    />
                    <FieldError fieldId={`${fieldId}-finished`} className={formStyles.error}>
                        {errors.finished_on}
                    </FieldError>
                </div>
                <div className={formStyles.field}>
                    <label htmlFor={`${fieldId}-cost`}>Kosten in €</label>
                    <Input
                        id={`${fieldId}-cost`}
                        size="md"
                        fullWidth
                        inputMode="decimal"
                        placeholder="z. B. 128,50"
                        value={cost}
                        onChange={(event) => {
                            setCost(event.target.value);
                            clear("cost");
                        }}
                        {...fieldAria(`${fieldId}-cost`, errors.cost, `${fieldId}-cost-hint`)}
                    />
                    <p className={formStyles.hint} id={`${fieldId}-cost-hint`}>
                        Freiwillig.
                    </p>
                    <FieldError fieldId={`${fieldId}-cost`} className={formStyles.error}>
                        {errors.cost}
                    </FieldError>
                </div>
            </div>

            {isHu && (
                <div className={`${formStyles.field} ${styles.callout}`}>
                    <label htmlFor={`${fieldId}-hu`}>Neue HU fällig</label>
                    <Input
                        id={`${fieldId}-hu`}
                        data-autofocus
                        type="month"
                        size="md"
                        className={styles.month}
                        value={huDueOn}
                        onChange={(event) => {
                            setHuDueOn(event.target.value);
                            clear("hu_due_on");
                        }}
                        {...fieldAria(`${fieldId}-hu`, errors.hu_due_on, `${fieldId}-hu-hint`)}
                    />
                    <p className={formStyles.hint} id={`${fieldId}-hu-hint`}>
                        Monat von der Plakette. Bisher {formatYearMonth(visit.hu_due_on)}; das
                        Datum in den Stammdaten wird ersetzt.
                    </p>
                    <FieldError fieldId={`${fieldId}-hu`} className={formStyles.error}>
                        {errors.hu_due_on}
                    </FieldError>
                </div>
            )}

            {visit.reason === "UVV" && (
                <p className={formStyles.hint}>
                    „UVV geprüft“ wird auf Fertig am gesetzt; die nächste UVV ergibt sich daraus.
                </p>
            )}

            <div className={formStyles.field}>
                <label htmlFor={`${fieldId}-note`}>Notiz</label>
                <Textarea
                    id={`${fieldId}-note`}
                    rows={2}
                    maxLength={WORKSHOP_NOTE_MAX}
                    value={note}
                    onChange={(event) => {
                        setNote(event.target.value);
                        clear("result_note");
                    }}
                    {...fieldAria(`${fieldId}-note`, errors.result_note)}
                />
                <FieldError fieldId={`${fieldId}-note`} className={formStyles.error}>
                    {errors.result_note}
                </FieldError>
            </div>

            <p className={styles.context}>
                Danach ist {visit.license_plate} wieder einsatzbereit und lässt sich einem Fahrer
                zuweisen.
            </p>

            {errors.form && (
                <p className={formStyles.error} role="alert">
                    {errors.form}
                </p>
            )}

            <div className={formStyles.actions}>
                <Button type="button" variant="secondary" size="md" onClick={onCancel}>
                    Abbrechen
                </Button>
                <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    busy={isSubmitting}
                    busyLabel="Wird gemeldet…"
                >
                    Fertig melden
                </Button>
            </div>
        </form>
    );
};
