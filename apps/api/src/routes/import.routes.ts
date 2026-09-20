import { Router } from "express";
import {
    commitImport,
    getImportProfile,
    listImportRuns,
    listPreviewRows,
    markExistingPreview,
    patchPreviewActions,
    previewImport,
    putImportProfile,
} from "../controllers/import.controller";
import { requireDispatcher } from "../middleware/requireDispatcher";

const router = Router();

router.post("/preview", requireDispatcher, previewImport);
router.get("/preview/:previewId/rows", requireDispatcher, listPreviewRows);
router.patch(
    "/preview/:previewId/actions",
    requireDispatcher,
    patchPreviewActions,
);
router.post(
    "/preview/:previewId/mark-existing",
    requireDispatcher,
    markExistingPreview,
);
router.post("/commit", requireDispatcher, commitImport);
router.get("/profile", requireDispatcher, getImportProfile);
router.put("/profile", requireDispatcher, putImportProfile);
router.get("/runs", requireDispatcher, listImportRuns);

export default router;
