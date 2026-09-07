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

const router = express.Router();

router.get("/", getVehicles);
router.get("/positions", getVehiclePositions);
router.get("/drivers", getVehicleDrivers);
router.get("/:id/telemetry", getVehicleTelemetry);
router.get("/:id/trips/latest", getVehicleTrip);
router.get("/:id/trips/:tripId", getVehicleTripById);
router.get("/:id/trips", getVehicleTrips);
router.get("/:id", getVehicleById);
router.post("/", requireDispatcher, createVehicle);
router.put("/:id", requireDispatcher, replaceVehicle);
router.patch("/:id", requireDispatcher, updateVehicle);
router.delete("/:id", requireDispatcher, deleteVehicle);

export default router;
