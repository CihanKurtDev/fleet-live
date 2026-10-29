import { useEffect, useId, useState, type FormEvent } from "react";
import {
    WORKSHOP_NOTE_MAX,
    WORKSHOP_PLACE_MAX,
    WORKSHOP_REASONS,
    WORKSHOP_REASON_LABELS,
    berlinTodayIso,
    type WorkshopReason,
    type WorkshopVisit,
} from "@fleet-live/shared";

import { listMembers, type Member } from "../../api/auth";
import { ApiError } from "../../api/client";
import {
    createWorkshopVisit,
    getWorkshopPlaces,
    updateWorkshopVisit,
    type WorkshopTarget,
} from "../../api/workshop";
import { useAuth } from "../../hooks/useAuth";
import { Button } from "../ui/Button/Button";
import { SwapLabel } from "../ui/Button/SwapLabel";
import { Checkbox } from "../ui/Checkbox/Checkbox";
import { FieldError } from "../ui/FieldError/FieldError";
import { fieldAria } from "../ui/FieldError/fieldAria";
import { Input } from "../ui/Input/Input";
import { Textarea } from "../ui/Input/Textarea";
import { Modal } from "../ui/Modal/Modal";
import { Select } from "../ui/Select/Select";
import formStyles from "./VehicleForm.module.scss";
import styles from "./workshop.module.scss";

type Field =
    | "reason"
    | "place"
    | "planned_on"
    | "expected_on"
    | "assignee_user_id"
    | "note"
    | "form";

interface WorkshopPlanDialogProps {
    /** Plan a new stay for this vehicle. */
    target: WorkshopTarget | null;
    /** Or edit this open stay. */
    visit?: WorkshopVisit | null;
    onClose: () => void;
    onSaved: (visit: WorkshopVisit, message: string) => void;
}

/** „In die Werkstatt“: plan a stay, or enter one that has already begun. */
export const WorkshopPlanDialog = ({
    target,
    visit = null,
    onClose,
    onSaved,
}: WorkshopPlanDialogProps) => {
    const open = target !== null || visit !== null;

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={visit ? "Aufenthalt bearbeiten" : "In die Werkstatt"}
            guardUnsaved
        >
            {open && (
                <PlanForm
                    key={visit ? `v${visit.id}` : `t${target?.vehicleId}`}
                    target={target}
                    visit={visit}
                    onCancel={onClose}
                    onSaved={onSaved}
                />
            )}
        </Modal>
    );
};

const PlanForm = ({
    target,
    visit,
    onCancel,
    onSaved,
}: {
    target: WorkshopTarget | null;
    visit: WorkshopVisit | null;
    onCancel: () => void;
    onSaved: (visit: WorkshopVisit, message: string) => void;
}) => {
    const fieldId = useId();
    const { user } = useAuth();
    const arrivedAlready = visit?.state === "IN_WORKSHOP";
    const [reason, setReason] = useState<WorkshopReason>(
        visit?.reason ?? target?.reason ?? "MAINTENANCE",
    );
    const [place, setPlace] = useState(visit?.place ?? "");
    const [plannedOn, setPlannedOn] = useState(visit?.planned_on ?? "");
    const [expectedOn, setExpectedOn] = useState(visit?.expected_on ?? "");
    const [assignee, setAssignee] = useState<number | null>(
        visit ? visit.assignee_user_id : (user?.id ?? null),
    );
    const [note, setNote] = useState(visit?.note ?? "");
    const [arrived, setArrived] = useState(false);
    const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [members, setMembers] = useState<Member[]>([]);
    const [places, setPlaces] = useState<string[]>([]);

    useEffect(() => {
        const controller = new AbortController();
        listMembers()
            .then((response) => setMembers(response.data))
            .catch(() => setMembers([]));
        getWorkshopPlaces(controller.signal)
            .then((response) => setPlaces(response.data))
            .catch(() => setPlaces([]));
        return () => controller.abort();
    }, []);

    const dispatchers = members.filter(
        (member) => member.role === "dispatcher" && !member.invited,
    );
    const plate = visit?.license_plate ?? target?.licensePlate ?? "";
    const context = visit
        ? `${plate} · ${WORKSHOP_REASON_LABELS[visit.reason]}`
        : [plate, target?.context].filter(Boolean).join(" · ");

    const clear = (field: Field) =>
        setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const local: Partial<Record<Field, string>> = {};
        if (place.trim() === "") local.place = "Werkstatt fehlt.";
        if (plannedOn === "") local.planned_on = arrived ? "Dort seit fehlt." : "Termin am fehlt.";
        if (assignee === null) local.assignee_user_id = "Zuständig fehlt.";
        if (Object.keys(local).length > 0) {
            setErrors(local);
            return;
        }

        setIsSubmitting(true);
        setErrors({});

        try {
            const fields = {
                reason,
                place: place.trim(),
                planned_on: plannedOn,
                expected_on: expectedOn === "" ? null : expectedOn,
                assignee_user_id: assignee as number,
                note: note.trim() === "" ? null : note.trim(),
            };
            if (visit) {
                const { data } = await updateWorkshopVisit(
                    visit.id,
                    arrivedAlready
                        ? {
                              place: fields.place,
                              expected_on: fields.expected_on,
                              assignee_user_id: fields.assignee_user_id,
                              note: fields.note,
                          }
                        : fields,
                );
                onSaved(data, "Aufenthalt gespeichert.");
            } else if (target) {
                const { data } = await createWorkshopVisit(target.vehicleId, {
                    ...fields,
                    arrived,
                });
                onSaved(
                    data,
                    arrived
                        ? `${plate} ist in der Werkstatt.`
                        : `Termin für ${plate} am ${plannedOn.split("-").reverse().join(".")} geplant.`,
                );
            }
        } catch (caught) {
            if (caught instanceof ApiError) {
                const fields = (caught.fields ?? {}) as Partial<Record<Field, string>>;
                const known = (Object.keys(fields) as Field[]).some(
                    (key) => key !== "form" && key in fields,
                );
                setErrors({ ...fields, form: known ? undefined : caught.message });
            } else {
                setErrors({ form: "Der Aufenthalt wurde nicht gespeichert." });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
            <p className={styles.context}>{context}</p>

            <fieldset className={styles.reasons} disabled={arrivedAlready}>
                <legend>Grund</legend>
                <div className={styles.reasonRow}>
                    {WORKSHOP_REASONS.map((value) => (
                        <label
                            key={value}
                            className={styles.reason}
                            data-checked={reason === value || undefined}
                        >
                            <input
                                type="radio"
                                name={`${fieldId}-reason`}
                                value={value}
                                checked={reason === value}
                                onChange={() => {
                                    setReason(value);
                                    clear("reason");
                                }}
                            />
                            {WORKSHOP_REASON_LABELS[value]}
                        </label>
                    ))}
                </div>
                <FieldError fieldId={`${fieldId}-reason`} className={formStyles.error}>
                    {errors.reason}
                </FieldError>
            </fieldset>

            <div className={formStyles.field}>
                <label htmlFor={`${fieldId}-place`}>Werkstatt</label>
                <Input
                    id={`${fieldId}-place`}
                    data-autofocus
                    size="md"
                    fullWidth
                    maxLength={WORKSHOP_PLACE_MAX}
                    list={`${fieldId}-places`}
                    autoComplete="off"
                    value={place}
                    onChange={(event) => {
                        setPlace(event.target.value);
                        clear("place");
                    }}
                    {...fieldAria(`${fieldId}-place`, errors.place, `${fieldId}-place-hint`)}
                />
                <datalist id={`${fieldId}-places`}>
                    {places.map((entry) => (
                        <option key={entry} value={entry} />
                    ))}
                </datalist>
                <p className={formStyles.hint} id={`${fieldId}-place-hint`}>
                    Vorschläge aus früheren Aufenthalten.
                </p>
                <FieldError fieldId={`${fieldId}-place`} className={formStyles.error}>
                    {errors.place}
                </FieldError>
            </div>

            <div className={styles.pair}>
                <div className={formStyles.field}>
                    <label htmlFor={`${fieldId}-planned`}>
                        {arrived || arrivedAlready ? "Dort seit" : "Termin am"}
                    </label>
                    <Input
                        id={`${fieldId}-planned`}
                        type="date"
                        size="md"
                        fullWidth
                        disabled={arrivedAlready}
                        max={arrived ? berlinTodayIso() : undefined}
                        value={plannedOn}
                        onChange={(event) => {
                            setPlannedOn(event.target.value);
                            clear("planned_on");
                        }}
                        {...fieldAria(`${fieldId}-planned`, errors.planned_on)}
                    />
                    <FieldError fieldId={`${fieldId}-planned`} className={formStyles.error}>
                        {errors.planned_on}
                    </FieldError>
                </div>
                <div className={formStyles.field}>
                    <label htmlFor={`${fieldId}-expected`}>Fertig erwartet am</label>
                    <Input
                        id={`${fieldId}-expected`}
                        type="date"
                        size="md"
                        fullWidth
                        min={plannedOn || undefined}
                        value={expectedOn}
                        onChange={(event) => {
                            setExpectedOn(event.target.value);
                            clear("expected_on");
                        }}
                        {...fieldAria(`${fieldId}-expected`, errors.expected_on)}
                    />
                    <FieldError fieldId={`${fieldId}-expected`} className={formStyles.error}>
                        {errors.expected_on}
                    </FieldError>
                </div>
            </div>

            <div className={formStyles.field}>
                <label htmlFor={`${fieldId}-assignee`}>Zuständig</label>
                <Select
                    id={`${fieldId}-assignee`}
                    size="md"
                    value={assignee === null ? "" : String(assignee)}
                    onChange={(event) => {
                        setAssignee(event.target.value === "" ? null : Number(event.target.value));
                        clear("assignee_user_id");
                    }}
                    {...fieldAria(
                        `${fieldId}-assignee`,
                        errors.assignee_user_id,
                        `${fieldId}-assignee-hint`,
                    )}
                >
                    {assignee === null && <option value="">Bitte wählen</option>}
                    {assignee !== null &&
                        !dispatchers.some((member) => member.user_id === assignee) && (
                            <option value={assignee}>
                                {visit?.assignee_name ?? user?.name ?? "—"}
                            </option>
                        )}
                    {dispatchers.map((member) => (
                        <option key={member.user_id} value={member.user_id}>
                            {member.user_id === user?.id ? `${member.name} (du)` : member.name}
                        </option>
                    ))}
                </Select>
                <p className={formStyles.hint} id={`${fieldId}-assignee-hint`}>
                    Dispatcher dieser Firma.
                </p>
                <FieldError fieldId={`${fieldId}-assignee`} className={formStyles.error}>
                    {errors.assignee_user_id}
                </FieldError>
            </div>

            <div className={formStyles.field}>
                <label htmlFor={`${fieldId}-note`}>Notiz</label>
                <Textarea
                    id={`${fieldId}-note`}
                    maxLength={WORKSHOP_NOTE_MAX}
                    value={note}
                    onChange={(event) => {
                        setNote(event.target.value);
                        clear("note");
                    }}
                    {...fieldAria(`${fieldId}-note`, errors.note)}
                />
                <FieldError fieldId={`${fieldId}-note`} className={formStyles.error}>
                    {errors.note}
                </FieldError>
            </div>

            {!visit && (
                <label className={styles.check}>
                    <Checkbox
                        checked={arrived}
                        onChange={(event) => {
                            setArrived(event.target.checked);
                            if (event.target.checked && plannedOn === "") {
                                setPlannedOn(berlinTodayIso());
                            }
                            clear("planned_on");
                        }}
                    />
                    Fahrzeug ist schon in der Werkstatt
                </label>
            )}

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
                    busyLabel="Wird gespeichert…"
                >
                    {visit ? (
                        "Speichern"
                    ) : (
                        <SwapLabel swapped={arrived} alt="Eintragen">
                            Termin planen
                        </SwapLabel>
                    )}
                </Button>
            </div>
        </form>
    );
};
