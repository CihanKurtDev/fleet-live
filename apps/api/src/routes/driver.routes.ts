import express from "express";
import { requireDriverNames } from "../lib/driverNames";
import { requireDispatcher } from "../middleware/requireDispatcher";
import {
    assignDriverVehicle,
    createDriver,
    deleteDriver,
    getDriverById,
    getDrivers,
    setDriverCurrentVehicle,
    unassignDriverVehicle,
    updateDriver,
} from "../controllers/driver.controller";

const router = express.Router();

// A company can keep the driver pages (each driver's violation history) to dispatchers.
router.get("/", requireDriverNames, getDrivers);
router.post("/", requireDispatcher, createDriver);
router.get("/:id", requireDriverNames, getDriverById);
router.patch("/:id", requireDispatcher, updateDriver);
router.delete("/:id", requireDispatcher, deleteDriver);
router.post("/:id/vehicles", requireDispatcher, assignDriverVehicle);
router.delete(
    "/:id/vehicles/:vehicleId",
    requireDispatcher,
    unassignDriverVehicle,
);
router.patch(
    "/:id/current-vehicle",
    requireDispatcher,
    setDriverCurrentVehicle,
);

export default router;
