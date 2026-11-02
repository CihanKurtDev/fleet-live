import { db } from "../db/database";
import { pruneResolvedAlerts } from "../db/alertRetention";
import { pruneAuditEvents } from "../db/auditRetention";
import { archiveStaleSpeeding } from "../db/stateAlerts";
import { logger } from "../logger";
import { TelemetryModel } from "../models/telemetry.model";
import { SpeedingEventModel } from "../models/speedingEvent.model";
import { ExceptionEventModel } from "../models/exceptionEvent.model";
import { SiteModel } from "../models/site.model";
import { DriveModel } from "../models/drive.model";
import { WorkshopModel } from "../models/workshop.model";
import { WorkshopPlaceModel } from "../models/workshopPlace.model";
import { playWorkshopTrips } from "../sim/workshopTrips";
import { broadcast } from "./hub";
import type { TelemetryPatch } from "@fleet-live/shared";

let timer: ReturnType<typeof setInterval> | undefined;
let intervalMs = 0;
let lastArchive = 0;

/** Ended speeding events that ran out of their open days and resolved warnings past their retention are looked for this often. */
const ARCHIVE_EVERY_MS = 10 * 60_000;
/** Workshop trips and pickups are looked for this often. */
const WORKSHOP_TRIPS_EVERY_MS = 10_000;
let lastWorkshopTrips = 0;

function broadcastPatches(
    patches: Array<TelemetryPatch & { company_id: number; parked?: true }>,
) {
    if (patches.length === 0) {
        return;
    }

    const byCompany = new Map<number, TelemetryPatch[]>();

    for (const patch of patches) {
        const { company_id, parked: _parked, ...wire } = patch;
        const group = byCompany.get(company_id);

        if (group) {
            group.push(wire);
            continue;
        }

        byCompany.set(company_id, [wire]);
    }

    for (const [companyId, group] of byCompany) {
        broadcast("telemetry", group, companyId);
    }
}

/**
 * What follows from a batch of pings: speeding, signal, depot and workshop
 * circles, a device that parked reporting ignition off, and arrivals at a
 * workshop. Returns the companies whose vehicles changed.
 */
export function applyTickEffects(
    patches: Array<TelemetryPatch & { company_id: number; parked?: true }>,
): Set<number> {
    const notifyCompanies = new Set<number>([
        ...SpeedingEventModel.applyPatches(patches),
        ...ExceptionEventModel.applyPatches(patches),
        ...SiteModel.applyPatches(patches),
        ...WorkshopPlaceModel.applyPatches(patches),
    ]);

    for (const patch of patches) {
        if (patch.parked) {
            DriveModel.report(patch.id, patch.company_id, "IDLE");
            notifyCompanies.add(patch.company_id);
        }
    }

    for (const companyId of WorkshopModel.detectArrivals()) {
        notifyCompanies.add(companyId);
    }

    return notifyCompanies;
}

export function isTelemetryTickerRunning(): boolean {
    return timer !== undefined;
}

/**
 * Der Simulator spielt Geräte: jedes Fahrzeug auf Fahrt meldet sich in seinem
 * eigenen Takt (`PING_INTERVAL_MS`), unabhängig davon, ob jemand zusieht. Der
 * Stream liefert die Pings nur an die Verbindungen, die das Fahrzeug im Fokus haben.
 */
export function startTelemetryTicker(ms: number) {
    intervalMs = ms;

    if (timer || ms <= 0) {
        return;
    }

    timer = setInterval(() => {
        try {
            const patches = TelemetryModel.tickDrivingVehicles();
            const notifyCompanies = applyTickEffects(patches);

            if (Date.now() - lastWorkshopTrips >= WORKSHOP_TRIPS_EVERY_MS) {
                lastWorkshopTrips = Date.now();

                const trips = playWorkshopTrips();
                for (const companyId of [...trips.companies, ...applyTickEffects(trips.patches)]) {
                    notifyCompanies.add(companyId);
                }
                patches.push(...trips.patches);
            }

            for (const companyId of ExceptionEventModel.applySilence()) {
                notifyCompanies.add(companyId);
            }

            for (const companyId of SpeedingEventModel.endStale()) {
                notifyCompanies.add(companyId);
            }

            if (Date.now() - lastArchive >= ARCHIVE_EVERY_MS) {
                lastArchive = Date.now();

                for (const companyId of archiveStaleSpeeding(db)) {
                    notifyCompanies.add(companyId);
                }

                pruneResolvedAlerts(db);
                pruneAuditEvents(db);
            }

            broadcastPatches(patches);

            for (const companyId of notifyCompanies) {
                broadcast("vehicles-changed", { at: Date.now() }, companyId);
            }

            if (patches.length > 0) {
                logger.debug(
                    {
                        pings: patches.length,
                        changedCompanies: notifyCompanies.size,
                    },
                    "telemetry tick completed",
                );
            }
        } catch (error) {
            logger.error({ err: error }, "telemetry tick failed");
        }
    }, ms);

    timer.unref?.();
    logger.info({ intervalMs: ms }, "telemetry ticker started");
}

export function stopTelemetryTicker() {
    if (!timer) {
        return;
    }

    clearInterval(timer);
    timer = undefined;
    logger.info("telemetry ticker stopped");
}

export function setTelemetryTickerRunning(running: boolean): boolean {
    if (running) {
        startTelemetryTicker(intervalMs);
    } else {
        stopTelemetryTicker();
    }

    return isTelemetryTickerRunning();
}
