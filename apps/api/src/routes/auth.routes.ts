import express from "express";
import { getMe, login, logout, logoutAll } from "../controllers/auth.controller";
import { requireAuth } from "../middleware/requireAuth";
import {
    loginAccountRateLimit,
    loginIpRateLimit,
} from "../middleware/loginRateLimit";

const router = express.Router();

router.post("/login", loginIpRateLimit, loginAccountRateLimit, login);
router.post("/logout", logout);
router.post("/logout-all", requireAuth, logoutAll);
router.get("/me", getMe);

export default router;
