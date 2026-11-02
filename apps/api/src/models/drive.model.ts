import { stmt } from "../db/statements";
import { ExceptionEventModel } from "./exceptionEvent.model";
import { SpeedingEventModel } from "./speedingEvent.model";
import { TelemetryModel } from "./telemetry.model";
import { TripModel } from "./trip.model";

/**
 * Start and end of a drive, the same whether a person sets the status or a
 * device reports it (the simulator plays the device).
 */
export class DriveModel {
    /** The drive ends where the vehicle stands: speed 0, open events end, the trip closes. */
    static end(vehicleId: number, companyId: number): void {
        TelemetryModel.recordStandstill(vehicleId);
        SpeedingEventModel.endForVehicle(vehicleId);
        TripModel.close(vehicleId);
        TripModel.pruneClosedForCompany(companyId);
    }

    /**
     * What a device reports when the ignition goes on or off. Only a vehicle
     * with a current driver drives (the simulator asks for it before).
     */
    static report(vehicleId: number, companyId: number, status: "DRIVING" | "IDLE"): void {
        stmt(`UPDATE vehicles SET status = ? WHERE id = ? AND company_id = ?`).run(
            status,
            vehicleId,
            companyId,
        );

        if (status === "DRIVING") {
            TripModel.open(vehicleId);
        } else {
            this.end(vehicleId, companyId);
        }

        ExceptionEventModel.syncVehicle({ id: vehicleId, status });
    }
}
