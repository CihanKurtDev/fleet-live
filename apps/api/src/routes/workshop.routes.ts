import express from "express";
import { requireDispatcher } from "../middleware/requireDispatcher";
import {
    arriveWorkshopVisit,
    cancelWorkshopVisit,
    finishWorkshopVisit,
    getWorkshopPlaces,
    patchWorkshopVisit,
} from "../controllers/workshop.controller";

const router = express.Router();

router.get("/places", requireDispatcher, getWorkshopPlaces);
router.patch("/:visitId", requireDispatcher, patchWorkshopVisit);
router.post("/:visitId/arrive", requireDispatcher, arriveWorkshopVisit);
router.post("/:visitId/finish", requireDispatcher, finishWorkshopVisit);
router.post("/:visitId/cancel", requireDispatcher, cancelWorkshopVisit);

export default router;
