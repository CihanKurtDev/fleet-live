import express from "express";
import {
    exportAlerts,
    exportPeriod,
    exportTrips,
    exportVehicles,
} from "../controllers/export.controller";
import { requireDispatcher } from "../middleware/requireDispatcher";

const router = express.Router();

router.get("/vehicles", requireDispatcher, exportVehicles);
router.get("/alerts", requireDispatcher, exportAlerts);
router.get("/trips", requireDispatcher, exportTrips);
router.get("/period", requireDispatcher, exportPeriod);

export default router;
