import express from "express";
import { requireDispatcher } from "../middleware/requireDispatcher";
import {
    arriveWorkshopVisit,
    cancelWorkshopVisit,
    finishWorkshopVisit,
    getWorkshopPlaces,
    patchWorkshopVisit,
    createWorkshopPlace,
    patchWorkshopPlace,
    deleteWorkshopPlace,
    addWorkshopCost,
    getGeocodeConfig,
    searchAddress,
} from "../controllers/workshop.controller";

const router = express.Router();

router.get("/places", getWorkshopPlaces);
// Address search for a new workshop: only on „Suchen“, through this proxy.
router.get("/geocode/config", getGeocodeConfig);
router.get("/geocode", requireDispatcher, searchAddress);
router.post("/places", requireDispatcher, createWorkshopPlace);
router.patch("/places/:placeId", requireDispatcher, patchWorkshopPlace);
router.delete("/places/:placeId", requireDispatcher, deleteWorkshopPlace);
router.patch("/:visitId", requireDispatcher, patchWorkshopVisit);
router.post("/:visitId/arrive", requireDispatcher, arriveWorkshopVisit);
router.post("/:visitId/finish", requireDispatcher, finishWorkshopVisit);
router.post("/:visitId/cancel", requireDispatcher, cancelWorkshopVisit);
router.post("/:visitId/cost", requireDispatcher, addWorkshopCost);

export default router;
