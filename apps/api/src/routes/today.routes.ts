import express from "express";
import { getToday } from "../controllers/today.controller";

const router = express.Router();

router.get("/", getToday);

export default router;
