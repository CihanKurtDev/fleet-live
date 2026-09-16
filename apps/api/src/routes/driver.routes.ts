import express from "express";
import { requireDispatcher } from "../middleware/requireDispatcher";
import {
    assignDriverVehicle,
    createDriver,
    getDriverById,
    getDrivers,
    setDriverCurrentVehicle,
    unassignDriverVehicle,
    updateDriver,
} from "../controllers/driver.controller";

const router = express.Router();

router.get("/", getDrivers);
router.post("/", requireDispatcher, createDriver);
router.get("/:id", getDriverById);
router.patch("/:id", requireDispatcher, updateDriver);
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
