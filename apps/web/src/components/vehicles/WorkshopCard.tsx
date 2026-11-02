import { Link } from "react-router";
import { workshopReasonsText, type WorkshopPlace } from "@fleet-live/shared";

import { formatCount } from "../../utils/formatCount";
import { Button } from "../ui/Button/Button";
import { shortDate } from "./workshopText";
import styles from "./PlaceCard.module.scss";

type WorkshopCardProps = {
    place: WorkshopPlace;
    canEdit: boolean;
    onEdit: () => void;
    onClose: () => void;
};

/** The workshop picked on the fleet map: who stands there, who is coming, how to reach it. */
export const WorkshopCard = ({ place, canEdit, onEdit, onClose }: WorkshopCardProps) => {
    const hidden = place.vehicles_here - place.here.length;

    return (
        <section className={styles.card} aria-label={`Werkstatt ${place.name}`}>
            <div className={styles.cardHead}>
                <span className={styles.kindTag}>Werkstatt</span>
                <h2 className={styles.title}>{place.name}</h2>
                <button type="button" className={styles.close} aria-label="Auswahl aufheben" onClick={onClose}>
                    ✕
                </button>
            </div>
            <dl className={styles.facts}>
                <dt>Jetzt dort</dt>
                <dd>
                    {place.here.length === 0
                        ? "kein Fahrzeug"
                        : place.here.map((vehicle, index) => (
                              <span key={vehicle.vehicle_id}>
                                  {index > 0 && ", "}
                                  <Link to={`/vehicles/${vehicle.vehicle_id}`}>{vehicle.license_plate}</Link>
                              </span>
                          ))}
                    {hidden > 0 && ` und ${formatCount(hidden)} weitere`}
                </dd>
                <dt>Termine</dt>
                <dd>
                    {place.appointments.length === 0 ? (
                        "keine offenen"
                    ) : (
                        <ul className={styles.plain}>
                            {place.appointments.map((entry) => (
                                <li key={entry.visit_id}>
                                    <Link to={`/vehicles/${entry.vehicle_id}`}>{entry.license_plate}</Link>
                                    {" · "}
                                    {entry.state === "IN_WORKSHOP"
                                        ? "dort"
                                        : `${shortDate(entry.planned_on)}${entry.planned_time ? ` ${entry.planned_time}` : ""}`}
                                    {entry.reasons.length > 0 && ` · ${workshopReasonsText(entry.reasons)}`}
                                </li>
                            ))}
                        </ul>
                    )}
                </dd>
                <dt>Adresse</dt>
                <dd>{place.address ?? <span className={styles.muted}>nicht eingetragen</span>}</dd>
                <dt>Telefon</dt>
                <dd>{place.phone ?? <span className={styles.muted}>nicht eingetragen</span>}</dd>
            </dl>
            {canEdit && (
                <div className={styles.cardActions}>
                    <Button variant="secondary" size="sm" onClick={onEdit}>
                        Bearbeiten
                    </Button>
                </div>
            )}
        </section>
    );
};
