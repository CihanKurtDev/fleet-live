import { useEffect, useId, useState, type FormEvent } from "react";
import {
    WORKSHOP_NOTE_MAX,
    WORKSHOP_REASON_LABELS,
    WORKSHOP_TRANSPORTS,
    WORKSHOP_TRANSPORT_LABELS,
    workshopReasonsText,
    berlinTodayIso,
    resolveDueSettings,
    sortWorkshopReasons,
    type Damage,
    type Site,
    type Vehicle,
    type WorkshopBringer,
    type WorkshopPlace,
    type WorkshopReason,
    type WorkshopTransport,
    type WorkshopVisit,
} from "@fleet-live/shared";

import { listMembers, type Member } from "../../api/auth";
import { ApiError } from "../../api/client";
import { listVehicleDamages } from "../../api/damages";
import { listSites } from "../../api/sites";
import { getVehicle } from "../../api/vehicles";
import {
    createWorkshopVisit,
    getWorkshopBringers,
    getWorkshopPlaces,
    updateWorkshopVisit,
    type WorkshopTarget,
} from "../../api/workshop";
import { useAuth } from "../../hooks/useAuth";
import { useDueSettings } from "../../hooks/useDueSettings";
import { formatIsoDate } from "../../utils/dateTime";
import { haversineMeters } from "../../utils/geo";
import { Button } from "../ui/Button/Button";
import { Checkbox } from "../ui/Checkbox/Checkbox";
import { FieldError } from "../ui/FieldError/FieldError";
import { fieldAria } from "../ui/FieldError/fieldAria";
import { Input } from "../ui/Input/Input";
import { Textarea } from "../ui/Input/Textarea";
import { Modal } from "../ui/Modal/Modal";
import { Select } from "../ui/Select/Select";
import { DamageDialog } from "./DamageDialog";
import { WorkshopPlaceDialog } from "./WorkshopPlaceDialog";
import { deadlineStateText, vehicleDeadlines, type VehicleDeadline } from "./vehicleDeadlines";
import formStyles from "./VehicleForm.module.scss";
import styles from "./workshop.module.scss";

type Field =
    | "reasons"
    | "transport"
    | "workshop_id"
    | "planned_on"
    | "planned_time"
    | "expected_on"
    | "bring_driver_id"
    | "assignee_user_id"
    | "note"
    | "damage_ids"
    | "form";

interface WorkshopPlanDialogProps {
    /** Plan a new stay for this vehicle. */
    target: WorkshopTarget | null;
    /** Or edit this open stay. */
    visit?: WorkshopVisit | null;
    onClose: () => void;
    onSaved: (visit: WorkshopVisit, message: string) => void;
}

/** Farther than this (straight line) from the vehicle's depot, the dialog asks whether there is no workshop nearer. */
const FAR_KM = 50;

/** The jobs besides damages, in the order of the list. */
const JOBS: Exclude<WorkshopReason, "DAMAGE">[] = ["HU", "UVV", "MAINTENANCE", "OTHER"];

const formatKm = (km: number) => `${km.toLocaleString("de-DE", { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;

const dayMonth = (iso: string) => iso.slice(8, 10) + "." + iso.slice(5, 7) + ".";

/** „Plakette 02/2026“ or „fällig 18.12.2026“. */
const deadlineDetail = (deadline: VehicleDeadline): string =>
    deadline.due_on === null
        ? "kein Datum eingetragen"
        : deadline.reason === "HU"
          ? `Plakette ${deadline.due_on.slice(5, 7)}/${deadline.due_on.slice(0, 4)}`
          : `fällig ${formatIsoDate(deadline.due_on)}`;

/** „In die Werkstatt“: plan a stay at one of the company's workshops. */
export const WorkshopPlanDialog = ({ target, visit = null, onClose, onSaved }: WorkshopPlanDialogProps) => {
    const open = target !== null || visit !== null;
    const missed = visit?.state === "PLANNED" && visit.planned_on < berlinTodayIso();
    const title = visit
        ? missed
            ? "Neu planen"
            : "Aufenthalt bearbeiten"
        : target?.standingAt
          ? "Aufenthalt anlegen"
          : "In die Werkstatt";

    return (
        <Modal open={open} onClose={onClose} title={title} guardUnsaved>
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
    const { settings: dueSettings } = useDueSettings();
    const leadDays = dueSettings?.lead_days ?? resolveDueSettings(undefined).lead_days;
    const vehicleId = visit?.vehicle_id ?? target?.vehicleId ?? 0;
    const arrivedAlready = visit?.state === "IN_WORKSHOP";
    const standingAt = !visit ? (target?.standingAt ?? null) : null;
    const today = berlinTodayIso();
    // A missed appointment gets a new date; the old one is history.
    const missed = visit?.state === "PLANNED" && visit.planned_on < today;

    const [jobs, setJobs] = useState<WorkshopReason[] | null>(
        visit ? visit.reasons.filter((reason) => reason !== "DAMAGE") : null,
    );
    const [workshopId, setWorkshopId] = useState<number | null>(
        visit?.workshop_id ?? standingAt?.id ?? null,
    );
    const [plannedOn, setPlannedOn] = useState(
        missed ? "" : (visit?.planned_on ?? (standingAt ? today : "")),
    );
    const [plannedTime, setPlannedTime] = useState(visit?.planned_time ?? "");
    const [expectedOn, setExpectedOn] = useState(missed ? "" : (visit?.expected_on ?? ""));
    const [transport, setTransport] = useState<WorkshopTransport | null>(visit?.transport ?? null);
    const [bringDriver, setBringDriver] = useState<number | null>(
        visit ? visit.bring_driver_id : (target?.currentDriverId ?? null),
    );
    const [assignee, setAssignee] = useState<number | null>(
        visit ? visit.assignee_user_id : (user?.id ?? null),
    );
    const [note, setNote] = useState(visit?.note ?? "");
    const [showNote, setShowNote] = useState(Boolean(visit?.note));
    const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [members, setMembers] = useState<Member[]>([]);
    const [places, setPlaces] = useState<WorkshopPlace[] | null>(null);
    const [sites, setSites] = useState<Site[]>([]);
    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [bringers, setBringers] = useState<WorkshopBringer[] | null>(null);
    /** Open damages this stay can take: free ones, and those it holds already. */
    const [damages, setDamages] = useState<Damage[]>([]);
    const [damageIds, setDamageIds] = useState<number[] | null>(
        target?.damageId ? [target.damageId] : null,
    );
    const [addingPlace, setAddingPlace] = useState(false);
    const [reportingDamage, setReportingDamage] = useState(false);
    const [reloadDamages, setReloadDamages] = useState(0);

    useEffect(() => {
        if (!vehicleId) {
            return;
        }
        const controller = new AbortController();
        getVehicle(vehicleId, controller.signal)
            .then(setVehicle)
            .catch(() => setVehicle(null));
        return () => controller.abort();
    }, [vehicleId]);

    useEffect(() => {
        const controller = new AbortController();
        listMembers()
            .then((response) => setMembers(response.data))
            .catch(() => setMembers([]));
        getWorkshopPlaces(controller.signal)
            .then((response) => setPlaces(response.data))
            .catch(() => setPlaces([]));
        listSites(controller.signal)
            .then((response) => setSites(response.data))
            .catch(() => setSites([]));
        return () => controller.abort();
    }, []);

    // Who may bring it depends on the day: another trip that day, a licence.
    const bringDay = plannedOn || today;
    useEffect(() => {
        if (!vehicleId) {
            return;
        }
        const controller = new AbortController();
        getWorkshopBringers(vehicleId, bringDay, controller.signal)
            .then((response) => setBringers(response.data))
            .catch(() => setBringers([]));
        return () => controller.abort();
    }, [vehicleId, bringDay]);

    useEffect(() => {
        if (!vehicleId) {
            return;
        }
        const controller = new AbortController();
        listVehicleDamages(vehicleId, controller.signal)
            .then((response) =>
                setDamages(
                    response.data.filter(
                        (damage) =>
                            damage.state === "OPEN" &&
                            (damage.workshop_visit_id === null ||
                                damage.workshop_visit_id === visit?.id ||
                                (damage.workshop_state !== "PLANNED" && damage.workshop_state !== "IN_WORKSHOP")),
                    ),
                ),
            )
            .catch(() => setDamages([]));
        return () => controller.abort();
    }, [vehicleId, visit?.id, reloadDamages]);

    const deadlines = vehicle ? vehicleDeadlines(vehicle, today, leadDays) : [];
    const due = (reason: WorkshopReason) =>
        deadlines.some((deadline) => deadline.reason === reason && (deadline.state === "overdue" || deadline.state === "soon"));

    // What is due is ticked until someone changes it: the target's reason, an
    // HU or UVV that is overdue or soon, and every open damage of a new stay.
    const chosenJobs =
        jobs ??
        sortWorkshopReasons([
            ...(target?.reason && target.reason !== "DAMAGE" ? [target.reason] : []),
            ...(["HU", "UVV"] as const).filter(due),
        ]);
    const chosenDamages =
        damageIds ??
        (visit
            ? damages.filter((damage) => damage.workshop_visit_id === visit.id).map((damage) => damage.id)
            : damages.map((damage) => damage.id));
    const reasons = sortWorkshopReasons([
        ...chosenJobs,
        ...(chosenDamages.length > 0 ? (["DAMAGE"] as const) : []),
    ]);

    const notDrivable = damages.some((damage) => !damage.drivable) || vehicle?.availability === "NOT_DRIVABLE";
    const chosenTransport: WorkshopTransport = transport ?? (notDrivable ? "TOW" : "DRIVER");

    // Distance from where the vehicle belongs, so it does not change while it drives.
    const homeSite = sites.find((site) => site.id === vehicle?.home_site_id) ?? null;
    const reference = homeSite
        ? { latitude: homeSite.latitude, longitude: homeSite.longitude, label: `vom Depot ${homeSite.name}` }
        : vehicle?.latitude != null && vehicle.longitude != null
          ? { latitude: vehicle.latitude, longitude: vehicle.longitude, label: "vom letzten Standort" }
          : target?.position
            ? { ...target.position, label: "vom letzten Standort" }
            : null;
    const sortedPlaces = [...(places ?? [])]
        .map((place) => ({
            place,
            km: reference
                ? haversineMeters(reference.latitude, reference.longitude, place.latitude, place.longitude) / 1000
                : null,
        }))
        .sort((left, right) => (left.km ?? 0) - (right.km ?? 0) || left.place.name.localeCompare(right.place.name, "de"));
    const chosenPlace = places?.find((place) => place.id === workshopId) ?? null;
    const nearest = sortedPlaces[0]?.km !== null ? (sortedPlaces[0] ?? null) : null;
    const chosenKm = sortedPlaces.find((entry) => entry.place.id === workshopId)?.km ?? null;
    const nearer = chosenKm !== null && nearest && nearest.place.id !== workshopId && (nearest.km ?? 0) < chosenKm ? nearest : null;
    const choosing = !arrivedAlready && !standingAt;
    const legacyPlace = visit && visit.workshop_id === null ? visit.place : null;

    const chosenBringer = bringers?.find((bringer) => bringer.id === bringDriver) ?? null;
    const bringerNote = (bringer: WorkshopBringer): string | null =>
        bringer.licence_expired
            ? "Führerschein abgelaufen"
            : bringer.other_transports.length > 0
              ? `bringt am ${dayMonth(bringDay)} schon ${bringer.other_transports.map((trip) => trip.license_plate).join(", ")}`
              : bringer.driving_plate
                ? `fährt gerade ${bringer.driving_plate}`
                : null;
    const bringerLabel = (bringer: WorkshopBringer): string => {
        const state = bringer.is_current ? "fährt es gerade" : bringerNote(bringer);
        return state ? `${bringer.name} – ${state}` : bringer.name;
    };

    const dispatchers = members.filter((member) => member.role === "dispatcher" && !member.invited);
    const plate = visit?.license_plate ?? target?.licensePlate ?? "";
    const context = visit
        ? missed
            ? `${plate} · Termin am ${formatIsoDate(visit.planned_on)} verpasst. Neues Datum wählen.`
            : `${plate} · ${workshopReasonsText(visit.reasons)}`
        : standingAt
          ? `${plate} steht bei ${standingAt.name}, ohne Termin.`
          : [plate, target?.context].filter(Boolean).join(" · ");

    const clear = (field: Field) => setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));

    const toggleJob = (job: WorkshopReason, on: boolean) => {
        setJobs(on ? sortWorkshopReasons([...chosenJobs, job]) : chosenJobs.filter((value) => value !== job));
        clear("reasons");
    };

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const local: Partial<Record<Field, string>> = {};
        if (reasons.length === 0) local.reasons = "Mindestens einen Punkt ankreuzen.";
        if (workshopId === null) local.workshop_id = "Werkstatt fehlt.";
        if (plannedOn === "") local.planned_on = missed ? "Neues Datum fehlt." : "Termin am fehlt.";
        if (expectedOn === "") local.expected_on = "Fertig erwartet fehlt.";
        if (assignee === null) local.assignee_user_id = "Zuständig fehlt.";
        if (chosenTransport === "DRIVER" && chosenBringer?.licence_expired) {
            local.bring_driver_id = `Der Führerschein von ${chosenBringer.name} ist abgelaufen.`;
        }
        if (Object.keys(local).length > 0) {
            setErrors(local);
            return;
        }

        setIsSubmitting(true);
        setErrors({});

        const bring = chosenTransport === "DRIVER" ? bringDriver : null;
        try {
            const fields = {
                reasons,
                transport: chosenTransport,
                workshop_id: workshopId as number,
                planned_on: plannedOn,
                planned_time: plannedTime === "" ? null : plannedTime,
                expected_on: expectedOn,
                bring_driver_id: bring,
                assignee_user_id: assignee as number,
                note: note.trim() === "" ? null : note.trim(),
                damage_ids: chosenDamages,
            };
            if (visit) {
                const { data } = await updateWorkshopVisit(
                    visit.id,
                    arrivedAlready
                        ? {
                              reasons,
                              damage_ids: chosenDamages,
                              expected_on: fields.expected_on,
                              assignee_user_id: fields.assignee_user_id,
                              note: fields.note,
                          }
                        : fields,
                );
                onSaved(
                    data,
                    missed
                        ? `Neuer Termin für ${plate} am ${dayMonth(plannedOn)} bei ${chosenPlace?.name ?? visit.place}.`
                        : "Aufenthalt gespeichert.",
                );
            } else if (target) {
                const { data } = await createWorkshopVisit(target.vehicleId, {
                    ...fields,
                    arrived: standingAt !== null,
                });
                const where = chosenPlace?.name ?? "";
                onSaved(
                    data,
                    standingAt
                        ? `${plate} ist bei ${where} in der Werkstatt.`
                        : `Termin für ${plate} am ${dayMonth(plannedOn)}${plannedTime ? ` um ${plannedTime}` : ""} bei ${where} geplant.`,
                );
            }
        } catch (caught) {
            if (caught instanceof ApiError) {
                const fields = (caught.fields ?? {}) as Partial<Record<Field, string>>;
                const known = Object.keys(fields).length > 0;
                setErrors({ ...fields, form: known ? undefined : caught.message });
            } else {
                setErrors({ form: "Der Aufenthalt wurde nicht gespeichert." });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <form className={formStyles.form} onSubmit={handleSubmit} noValidate>
                <p className={styles.context}>{context}</p>

                <fieldset className={styles.reasons}>
                    <div className={styles.labelRow}>
                        <legend>Was gemacht wird</legend>
                        <button type="button" className={styles.inlineAction} onClick={() => setReportingDamage(true)}>
                            Schaden melden
                        </button>
                    </div>
                    <ul className={styles.todo}>
                        {damages.map((damage) => {
                            const checked = chosenDamages.includes(damage.id);
                            return (
                                <li key={`d${damage.id}`}>
                                    <label data-checked={checked || undefined}>
                                        <Checkbox
                                            checked={checked}
                                            onChange={(event) => {
                                                setDamageIds(
                                                    event.target.checked
                                                        ? [...chosenDamages, damage.id]
                                                        : chosenDamages.filter((id) => id !== damage.id),
                                                );
                                                clear("damage_ids");
                                                clear("reasons");
                                            }}
                                        />
                                        <span>
                                            Schaden: {damage.description}
                                            <small>
                                                gemeldet {formatIsoDate(damage.occurred_on)} ·{" "}
                                                {damage.drivable ? "fahrbereit" : "nicht fahrbereit"}
                                            </small>
                                        </span>
                                        <span className={styles.todoState} data-tone="warning">
                                            offen
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                        {JOBS.map((job) => {
                            const checked = chosenJobs.includes(job);
                            const deadline = deadlines.find((entry) => entry.reason === job) ?? null;
                            const stateText = deadline ? deadlineStateText(deadline, today) : "";
                            return (
                                <li key={job}>
                                    <label data-checked={checked || undefined}>
                                        <Checkbox checked={checked} onChange={(event) => toggleJob(job, event.target.checked)} />
                                        <span>
                                            {WORKSHOP_REASON_LABELS[job]}
                                            {deadline && <small>{deadlineDetail(deadline)}</small>}
                                        </span>
                                        <span
                                            className={styles.todoState}
                                            data-tone={deadline && (deadline.state === "overdue" || deadline.state === "soon") ? "warning" : undefined}
                                        >
                                            {stateText}
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                    <FieldError fieldId={`${fieldId}-reasons`} className={formStyles.error}>
                        {errors.reasons ?? errors.damage_ids}
                    </FieldError>
                </fieldset>

                <div className={formStyles.field}>
                    <div className={styles.labelRow}>
                        <label htmlFor={`${fieldId}-workshop`}>Werkstatt</label>
                        {!arrivedAlready && !standingAt && (
                            <button type="button" className={styles.inlineAction} onClick={() => setAddingPlace(true)}>
                                Neue Werkstatt
                            </button>
                        )}
                    </div>
                    <Select
                        id={`${fieldId}-workshop`}
                        data-autofocus
                        size="md"
                        fullWidth
                        disabled={arrivedAlready || standingAt !== null}
                        value={workshopId === null ? "" : String(workshopId)}
                        onChange={(event) => {
                            setWorkshopId(event.target.value === "" ? null : Number(event.target.value));
                            clear("workshop_id");
                        }}
                        {...fieldAria(`${fieldId}-workshop`, errors.workshop_id, chosenPlace ? `${fieldId}-contact` : undefined)}
                    >
                        <option value="">{places === null ? "Wird geladen …" : places.length === 0 ? "Noch keine Werkstatt angelegt" : "Bitte wählen"}</option>
                        {sortedPlaces.map(({ place, km }) => (
                            <option key={place.id} value={place.id}>
                                {km === null || !reference ? place.name : `${place.name} · ${formatKm(km)} ${reference.label}`}
                            </option>
                        ))}
                    </Select>
                    {legacyPlace && workshopId === null && (
                        <p className={styles.placeLine}>
                            „{legacyPlace}“ ist keine angelegte Werkstatt. Bitte eine wählen oder neu anlegen.
                        </p>
                    )}
                    {choosing && !chosenPlace && !legacyPlace && nearest && nearest.km !== null && reference && (
                        <p className={styles.placeLine}>
                            {nearest.km <= FAR_KM ? (
                                <>
                                    Am nächsten: <strong>{nearest.place.name}</strong> · {formatKm(nearest.km)} {reference.label}.{" "}
                                    <button
                                        type="button"
                                        className={styles.inlineAction}
                                        onClick={() => {
                                            setWorkshopId(nearest.place.id);
                                            clear("workshop_id");
                                        }}
                                    >
                                        Übernehmen
                                    </button>
                                </>
                            ) : (
                                // Nothing nearby to suggest: say so instead of offering a far one.
                                <>
                                    Keine Werkstatt näher als {FAR_KM} km {reference.label}; die nächste ist{" "}
                                    <strong>{nearest.place.name}</strong> · {formatKm(nearest.km)}.
                                </>
                            )}
                        </p>
                    )}
                    {choosing && chosenKm !== null && chosenKm > FAR_KM && reference && (
                        <div className={styles.farBox} role="status">
                            <p>
                                <strong>{formatKm(chosenKm)}</strong> Luftlinie {reference.label}.{" "}
                                {nearer && nearer.km !== null
                                    ? <>Näher liegt <strong>{nearer.place.name}</strong> · {formatKm(nearer.km)}.</>
                                    : "Gibt es keine Werkstatt in der Nähe?"}
                            </p>
                            <Button
                                variant="secondary"
                                size="row"
                                onClick={() => {
                                    if (nearer) {
                                        setWorkshopId(nearer.place.id);
                                        clear("workshop_id");
                                    } else {
                                        setAddingPlace(true);
                                    }
                                }}
                            >
                                {nearer ? `${nearer.place.name} nehmen` : "Neue Werkstatt"}
                            </Button>
                        </div>
                    )}
                    {chosenPlace && (chosenPlace.address || chosenPlace.phone) && (
                        <p className={styles.placeLine} id={`${fieldId}-contact`}>
                            {[chosenPlace.address, chosenPlace.phone].filter(Boolean).join(" · ")}
                        </p>
                    )}
                    <FieldError fieldId={`${fieldId}-workshop`} className={formStyles.error}>
                        {errors.workshop_id}
                    </FieldError>
                </div>

                <div className={styles.trio}>
                    {!standingAt && (
                        <div className={formStyles.field}>
                            <label htmlFor={`${fieldId}-planned`}>{missed ? "Neuer Termin" : "Termin am"}</label>
                            <Input
                                id={`${fieldId}-planned`}
                                type="date"
                                size="md"
                                fullWidth
                                disabled={arrivedAlready}
                                min={arrivedAlready ? undefined : today}
                                value={plannedOn}
                                onChange={(event) => {
                                    const next = event.target.value;
                                    setPlannedOn(next);
                                    if (expectedOn === "" || expectedOn < next) setExpectedOn(next);
                                    clear("planned_on");
                                }}
                                {...fieldAria(`${fieldId}-planned`, errors.planned_on)}
                            />
                            <FieldError fieldId={`${fieldId}-planned`} className={formStyles.error}>
                                {errors.planned_on}
                            </FieldError>
                        </div>
                    )}
                    {!standingAt && (
                        <div className={formStyles.field}>
                            <label htmlFor={`${fieldId}-time`}>Uhrzeit</label>
                            <Input
                                id={`${fieldId}-time`}
                                type="time"
                                size="md"
                                fullWidth
                                disabled={arrivedAlready}
                                value={plannedTime}
                                onChange={(event) => {
                                    setPlannedTime(event.target.value);
                                    clear("planned_time");
                                }}
                                {...fieldAria(`${fieldId}-time`, errors.planned_time)}
                            />
                            <FieldError fieldId={`${fieldId}-time`} className={formStyles.error}>
                                {errors.planned_time}
                            </FieldError>
                        </div>
                    )}
                    <div className={formStyles.field}>
                        <label htmlFor={`${fieldId}-expected`}>Fertig erwartet</label>
                        <Input
                            id={`${fieldId}-expected`}
                            type="date"
                            size="md"
                            fullWidth
                            min={plannedOn || today}
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

                {!standingAt && (
                    <fieldset className={styles.reasons} disabled={arrivedAlready}>
                        <legend>Wie kommt es hin?</legend>
                        <div className={styles.reasonRow}>
                            {WORKSHOP_TRANSPORTS.map((value) => {
                                const blocked = value === "DRIVER" && notDrivable;
                                return (
                                    <label
                                        key={value}
                                        className={styles.reason}
                                        data-checked={chosenTransport === value || undefined}
                                        data-disabled={blocked || undefined}
                                    >
                                        <input
                                            type="radio"
                                            name={`${fieldId}-transport`}
                                            value={value}
                                            disabled={blocked}
                                            checked={chosenTransport === value}
                                            onChange={() => {
                                                setTransport(value);
                                                clear("transport");
                                                clear("bring_driver_id");
                                            }}
                                        />
                                        {WORKSHOP_TRANSPORT_LABELS[value]}
                                    </label>
                                );
                            })}
                        </div>
                        {notDrivable && (
                            <p className={styles.placeLine}>
                                Nicht fahrbereit: Niemand fährt es hin. Steht es abgeschleppt im Kreis der Werkstatt, erkennt
                                fleet-live die Ankunft an der Position.
                            </p>
                        )}
                        <FieldError fieldId={`${fieldId}-transport`} className={formStyles.error}>
                            {errors.transport}
                        </FieldError>
                    </fieldset>
                )}

                <div className={styles.pair}>
                    {!standingAt && chosenTransport === "DRIVER" && (
                        <div className={formStyles.field}>
                            <label htmlFor={`${fieldId}-bring`}>Wer bringt es hin?</label>
                            <Select
                                id={`${fieldId}-bring`}
                                size="md"
                                fullWidth
                                disabled={arrivedAlready}
                                value={bringDriver === null ? "" : String(bringDriver)}
                                onChange={(event) => {
                                    setBringDriver(event.target.value === "" ? null : Number(event.target.value));
                                    clear("bring_driver_id");
                                }}
                                {...fieldAria(`${fieldId}-bring`, errors.bring_driver_id)}
                            >
                                <option value="">Noch offen</option>
                                {(bringers ?? []).map((bringer) => (
                                    <option key={bringer.id} value={bringer.id} disabled={bringer.licence_expired}>
                                        {bringerLabel(bringer)}
                                    </option>
                                ))}
                            </Select>
                            {bringers !== null && bringers.length === 0 && (
                                <p className={styles.placeLine}>
                                    Für dieses Fahrzeug ist kein Fahrer freigegeben. Freigeben auf der Fahrzeugseite unter
                                    Stammdaten → Fahrer → Verwalten.
                                </p>
                            )}
                            {chosenBringer && !chosenBringer.is_current && bringerNote(chosenBringer) && (
                                <p className={styles.bringNote}>
                                    {chosenBringer.name}: {bringerNote(chosenBringer)}.
                                </p>
                            )}
                            <FieldError fieldId={`${fieldId}-bring`} className={formStyles.error}>
                                {errors.bring_driver_id}
                            </FieldError>
                        </div>
                    )}
                    <div className={formStyles.field}>
                        <label htmlFor={`${fieldId}-assignee`}>Zuständig</label>
                        <Select
                            id={`${fieldId}-assignee`}
                            size="md"
                            fullWidth
                            value={assignee === null ? "" : String(assignee)}
                            onChange={(event) => {
                                setAssignee(event.target.value === "" ? null : Number(event.target.value));
                                clear("assignee_user_id");
                            }}
                            {...fieldAria(`${fieldId}-assignee`, errors.assignee_user_id)}
                        >
                            {assignee === null && <option value="">Bitte wählen</option>}
                            {assignee !== null && !dispatchers.some((member) => member.user_id === assignee) && (
                                <option value={assignee}>{visit?.assignee_name ?? user?.name ?? "—"}</option>
                            )}
                            {dispatchers.map((member) => (
                                <option key={member.user_id} value={member.user_id}>
                                    {member.user_id === user?.id ? `${member.name} (du)` : member.name}
                                </option>
                            ))}
                        </Select>
                        <FieldError fieldId={`${fieldId}-assignee`} className={formStyles.error}>
                            {errors.assignee_user_id}
                        </FieldError>
                    </div>
                </div>

                {showNote ? (
                    <div className={formStyles.field}>
                        <label htmlFor={`${fieldId}-note`}>Notiz für die Werkstatt</label>
                        <Textarea
                            id={`${fieldId}-note`}
                            data-autofocus={!visit || undefined}
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
                ) : (
                    <div>
                        <button type="button" className={styles.inlineAction} onClick={() => setShowNote(true)}>
                            Notiz hinzufügen
                        </button>
                    </div>
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
                    <Button type="submit" variant="primary" size="md" busy={isSubmitting} busyLabel="Wird gespeichert…">
                        {visit ? (missed ? "Neu planen" : "Speichern") : standingAt ? "Aufenthalt anlegen" : "Termin planen"}
                    </Button>
                </div>
            </form>

            <WorkshopPlaceDialog
                open={addingPlace}
                center={reference}
                onClose={() => setAddingPlace(false)}
                onSaved={(place) => {
                    setAddingPlace(false);
                    setPlaces((current) => [...(current ?? []), place]);
                    setWorkshopId(place.id);
                    clear("workshop_id");
                }}
            />

            <DamageDialog
                target={reportingDamage ? { vehicleId, licensePlate: plate } : null}
                licensePlate={plate}
                onClose={() => setReportingDamage(false)}
                onSaved={(damage) => {
                    setReportingDamage(false);
                    setDamageIds([...chosenDamages, damage.id]);
                    setReloadDamages((value) => value + 1);
                    clear("damage_ids");
                }}
            />
        </>
    );
};
