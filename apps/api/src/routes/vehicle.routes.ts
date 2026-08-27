import express from "express";
import {
    createVehicle,
    deleteVehicle,
    getVehicleById,
    getVehicleTelemetry,
    getVehicles,
    replaceVehicle,
    updateVehicle,
} from "../controllers/vehicle.controller";

const router = express.Router();

router.get("/", getVehicles);
router.get("/:id/telemetry", getVehicleTelemetry);
router.get("/:id", getVehicleById);
router.post("/", createVehicle);
router.put("/:id", replaceVehicle);
router.patch("/:id", updateVehicle);
router.delete("/:id", deleteVehicle);

export default router;
