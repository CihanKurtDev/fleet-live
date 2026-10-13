import express from "express";
import { getDue } from "../controllers/due.controller";

const router = express.Router();

router.get("/", getDue);

export default router;
