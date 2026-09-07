import { Router } from "express";
import { commitImport, previewImport } from "../controllers/import.controller";
import { requireDispatcher } from "../middleware/requireDispatcher";

const router = Router();

router.post("/preview", requireDispatcher, previewImport);
router.post("/commit", requireDispatcher, commitImport);

export default router;
