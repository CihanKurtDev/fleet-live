import { Router } from "express";
import {
    commitImport,
    getImportProfile,
    listImportRuns,
    previewImport,
    putImportProfile,
} from "../controllers/import.controller";
import { requireDispatcher } from "../middleware/requireDispatcher";

const router = Router();

router.post("/preview", requireDispatcher, previewImport);
router.post("/commit", requireDispatcher, commitImport);
router.get("/profile", requireDispatcher, getImportProfile);
router.put("/profile", requireDispatcher, putImportProfile);
router.get("/runs", requireDispatcher, listImportRuns);

export default router;
