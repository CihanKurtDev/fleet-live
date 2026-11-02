import { isCompanySimRunning } from "../lib/simControl";
import { DriveModel } from "../models/drive.model";
import { TelemetryModel } from "../models/telemetry.model";
import { WorkshopModel } from "../models/workshop.model";
import { setSimDestination } from "./routes";

/** A driver sets off this long before a timed appointment. */
const LEAVE_BEFORE_MIN = 60;

const berlinClock = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
});

/** Minutes since midnight in Berlin. */
function berlinMinutes(now: Date): number {
    const [hours, minutes] = berlinClock.format(now).split(":").map(Number);
    return (hours ?? 0) * 60 + (minutes ?? 0);
}

function timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(":").map(Number);
    return (hours ?? 0) * 60 + (minutes ?? 0);
}

/**
 * What drivers do with a workshop appointment, played the way a device would
 * show it: on the appointment day (from an hour before a set time) a driving
 * vehicle heads to the workshop and parks there; a standing one with a driver
 * sets off first. A finished vehicle that stands at the workshop with a driver
 * drives off again. The app only sees positions and ignition, and recognises
 * arrival and pickup from them (`WorkshopModel.detectArrivals`,
 * `WorkshopPlaceModel.applyPatches`). A vehicle that is towed or fetched by
 * the workshop is not driven: at the appointment it reports its position at
 * the workshop with the ignition off (the patches, for the ticker to apply).
 * Returns the companies whose vehicles changed.
 */
export function playWorkshopTrips(now = new Date()): {
    companies: number[];
    patches: NonNullable<ReturnType<typeof TelemetryModel.recordMovedTo>>[];
} {
    const companies = new Set<number>();
    const patches: NonNullable<ReturnType<typeof TelemetryModel.recordMovedTo>>[] = [];
    const minutes = berlinMinutes(now);

    for (const target of WorkshopModel.simTargets()) {
        if (!isCompanySimRunning(target.company_id)) {
            continue;
        }

        if (target.kind === "pickup") {
            DriveModel.report(target.vehicle_id, target.company_id, "DRIVING");
            companies.add(target.company_id);
            continue;
        }

        const due =
            target.planned_time === null ||
            minutes >= timeToMinutes(target.planned_time) - LEAVE_BEFORE_MIN;

        if (target.there || !due || target.latitude === null || target.longitude === null) {
            continue;
        }

        if (target.transport !== "DRIVER") {
            if (!target.driving) {
                const patch = TelemetryModel.recordMovedTo(
                    target.vehicle_id,
                    target.latitude,
                    target.longitude,
                );
                if (patch) {
                    patches.push(patch);
                    companies.add(target.company_id);
                }
            }
            continue;
        }

        if (target.driving) {
            setSimDestination(target.vehicle_id, {
                lat: target.latitude,
                lng: target.longitude,
            });
            continue;
        }

        // Standing with a driver: the driver sets off; the next round sends it there.
        if (target.has_driver) {
            DriveModel.report(target.vehicle_id, target.company_id, "DRIVING");
            companies.add(target.company_id);
        }
    }

    return { companies: [...companies], patches };
}
