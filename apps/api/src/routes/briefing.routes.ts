import express from "express";
import { getBriefing } from "../controllers/briefing.controller";

const router = express.Router();

router.get("/", getBriefing);

export default router;
