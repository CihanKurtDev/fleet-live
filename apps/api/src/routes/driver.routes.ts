import express from "express";
import { getDriverById, getDrivers } from "../controllers/driver.controller";

const router = express.Router();

router.get("/", getDrivers);
router.get("/:id", getDriverById);

export default router;
