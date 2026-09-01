import express from "express";
import { requireDispatcher } from "../middleware/requireDispatcher";
import { getAlerts, resolveAlert } from "../controllers/alert.controller";

const router = express.Router();

router.get("/", getAlerts);
router.patch("/:id", requireDispatcher, resolveAlert);

export default router;
