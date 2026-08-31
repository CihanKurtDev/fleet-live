import express from "express";
import { getMe, login, logout } from "../controllers/auth.controller";

const router = express.Router();

router.post("/login", login);
router.post("/logout", logout);
router.get("/me", getMe);

export default router;
