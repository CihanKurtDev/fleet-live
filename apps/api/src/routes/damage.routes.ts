import express from "express";
import { DAMAGE_PHOTO_MAX_BYTES, DAMAGE_PHOTO_TYPES } from "@fleet-live/shared";
import { requireDispatcher } from "../middleware/requireDispatcher";
import {
    addDamagePhoto,
    closeDamage,
    deleteDamagePhoto,
    getDamagePhoto,
    patchDamage,
} from "../controllers/damage.controller";

const router = express.Router();

// The photo is read after the role check, never for anyone who sends a body.
const photoBody = express.raw({
    type: [...DAMAGE_PHOTO_TYPES],
    limit: DAMAGE_PHOTO_MAX_BYTES,
});

router.patch("/:damageId", requireDispatcher, patchDamage);
router.post("/:damageId/close", requireDispatcher, closeDamage);
router.post("/:damageId/photos", requireDispatcher, photoBody, addDamagePhoto);
router.get("/:damageId/photos/:photoId", getDamagePhoto);
router.delete("/:damageId/photos/:photoId", requireDispatcher, deleteDamagePhoto);

export default router;
