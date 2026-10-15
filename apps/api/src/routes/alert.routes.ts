import express from "express";
import { requireDispatcher } from "../middleware/requireDispatcher";
import {
    getAlerts,
    resolveAlert,
    resolveAlerts,
} from "../controllers/alert.controller";

const router = express.Router();

router.get("/", getAlerts);
router.patch("/", requireDispatcher, resolveAlerts);
router.patch("/:id", requireDispatcher, resolveAlert);

export default router;
