import express from "express";
import {
    exportAlerts,
    exportTrips,
    exportVehicles,
} from "../controllers/export.controller";
import { requireDispatcher } from "../middleware/requireDispatcher";

const router = express.Router();

router.get("/vehicles", requireDispatcher, exportVehicles);
router.get("/alerts", requireDispatcher, exportAlerts);
router.get("/trips", requireDispatcher, exportTrips);

export default router;
