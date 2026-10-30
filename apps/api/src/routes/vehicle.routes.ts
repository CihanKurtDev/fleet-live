import express from "express";
import { requireDispatcher } from "../middleware/requireDispatcher";
import {
    createVehicle,
    deleteVehicle,
    getVehicleById,
    getVehicleDrivers,
    getVehiclePositions,
    getVehicleTelemetry,
    getVehicleTrip,
    getVehicleTripById,
    getVehicleTrips,
    getVehicles,
    replaceVehicle,
    updateVehicle,
} from "../controllers/vehicle.controller";
import {
    createVehicleWorkshop,
    getVehicleWorkshop,
    patchVehicleAvailability,
} from "../controllers/workshop.controller";
import {
    createVehicleDamage,
    getVehicleDamages,
} from "../controllers/damage.controller";

const router = express.Router();

router.get("/", getVehicles);
router.get("/positions", getVehiclePositions);
router.get("/drivers", getVehicleDrivers);
router.get("/:id/telemetry", getVehicleTelemetry);
router.get("/:id/trips/latest", getVehicleTrip);
router.get("/:id/trips/:tripId", getVehicleTripById);
router.get("/:id/trips", getVehicleTrips);
router.get("/:id/workshop", getVehicleWorkshop);
router.post("/:id/workshop", requireDispatcher, createVehicleWorkshop);
router.patch("/:id/availability", requireDispatcher, patchVehicleAvailability);
router.get("/:id/damages", getVehicleDamages);
router.post("/:id/damages", requireDispatcher, createVehicleDamage);
router.get("/:id", getVehicleById);
router.post("/", requireDispatcher, createVehicle);
router.put("/:id", requireDispatcher, replaceVehicle);
router.patch("/:id", requireDispatcher, updateVehicle);
router.delete("/:id", requireDispatcher, deleteVehicle);

export default router;
