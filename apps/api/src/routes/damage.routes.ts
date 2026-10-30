import express from "express";
import { requireDispatcher } from "../middleware/requireDispatcher";
import { closeDamage, patchDamage } from "../controllers/damage.controller";

const router = express.Router();

router.patch("/:damageId", requireDispatcher, patchDamage);
router.post("/:damageId/close", requireDispatcher, closeDamage);

export default router;
