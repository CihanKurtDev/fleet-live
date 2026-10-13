import express from "express";
import { getDue, getDueSettings, patchDueSettings } from "../controllers/due.controller";
import { requireDispatcher } from "../middleware/requireDispatcher";

const router = express.Router();

router.get("/settings", getDueSettings);
router.patch("/settings", requireDispatcher, patchDueSettings);
router.get("/", getDue);

export default router;
