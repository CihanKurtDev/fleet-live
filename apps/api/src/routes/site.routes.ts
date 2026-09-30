import express from "express";
import { requireDispatcher } from "../middleware/requireDispatcher";
import {
    createSite,
    deleteSite,
    listSites,
    updateSite,
} from "../controllers/site.controller";

const router = express.Router();

router.get("/", listSites);
router.post("/", requireDispatcher, createSite);
router.patch("/:id", requireDispatcher, updateSite);
router.delete("/:id", requireDispatcher, deleteSite);

export default router;
