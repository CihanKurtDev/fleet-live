import express from "express";
import {
    acceptInviteHandler,
    changePassword,
    confirmTotp,
    createCompany,
    createInvite,
    deleteMember,
    disableTotp,
    dismissImport,
    forgotPassword,
    getMe,
    getMembers,
    getSecurity,
    login,
    logout,
    logoutAll,
    patchMember,
    patchSecurity,
    register,
    resendVerification,
    resetPasswordHandler,
    setupTotp,
    switchCompany,
    verifyEmail,
} from "../controllers/auth.controller";
import {
    finishSso,
    listSsoProviders,
    startCompanySso,
    startSso,
} from "../controllers/authSso.controller";
import { requireAuth } from "../middleware/requireAuth";
import { requireDispatcher } from "../middleware/requireDispatcher";
import {
    authIpRateLimit,
    loginAccountRateLimit,
    loginIpRateLimit,
} from "../middleware/loginRateLimit";

const router = express.Router();

router.post("/register", authIpRateLimit, register);
router.post("/resend-verification", authIpRateLimit, resendVerification);
router.post("/verify-email", verifyEmail);
router.post("/login", loginIpRateLimit, loginAccountRateLimit, login);
router.post("/logout", logout);
router.post("/logout-all", requireAuth, logoutAll);
router.get("/me", getMe);
router.post("/forgot-password", authIpRateLimit, forgotPassword);
router.post("/reset-password", resetPasswordHandler);
router.post("/password", requireAuth, changePassword);
router.post("/invites", requireAuth, requireDispatcher, createInvite);
router.post("/invites/accept", acceptInviteHandler);
router.get("/members", requireAuth, requireDispatcher, getMembers);
router.patch("/members/:userId", requireAuth, requireDispatcher, patchMember);
router.delete("/members/:userId", requireAuth, requireDispatcher, deleteMember);
router.post("/companies", requireAuth, createCompany);
router.post("/company", requireAuth, switchCompany);
router.post("/import-prompt/dismiss", requireAuth, dismissImport);
router.get("/security", requireAuth, requireDispatcher, getSecurity);
router.patch("/security", requireAuth, requireDispatcher, patchSecurity);
router.post("/totp/setup", setupTotp);
router.post("/totp/confirm", confirmTotp);
router.post("/totp", confirmTotp);
router.post("/totp/disable", requireAuth, disableTotp);
router.get("/sso/providers", listSsoProviders);
router.get("/sso/company/start", startCompanySso);
router.get("/sso/company/callback", finishSso);
router.get("/sso/:provider/start", startSso);
router.get("/sso/:provider/callback", finishSso);

export default router;
