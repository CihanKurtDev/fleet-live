import express from "express";
import {
    acceptInvitationHandler,
    acceptInviteHandler,
    changePassword,
    confirmTotp,
    createCompany,
    createInvite,
    declineInvitationHandler,
    deleteMember,
    disableTotp,
    dismissImport,
    forgotPassword,
    getAudit,
    getInvitations,
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
    withdrawInviteHandler,
} from "../controllers/auth.controller";
import {
    finishSso,
    discoverCompanySso,
    listSsoProviders,
    startCompanySso,
    startSso,
    startSsoLink,
    unlinkSso,
} from "../controllers/authSso.controller";
import { requireAuth } from "../middleware/requireAuth";
import { requireDispatcher } from "../middleware/requireDispatcher";
import {
    authIpRateLimit,
    loginIpRateLimit,
    ssoStartRateLimit,
    tokenIpRateLimit,
} from "../middleware/loginRateLimit";

const router = express.Router();

router.post("/register", authIpRateLimit, register);
router.post("/resend-verification", authIpRateLimit, resendVerification);
router.post("/verify-email", tokenIpRateLimit, verifyEmail);
// Wrong passwords per address slow down in the controller (lib/loginAttempts.ts).
router.post("/login", loginIpRateLimit, login);
router.post("/logout", logout);
router.post("/logout-all", requireAuth, logoutAll);
router.get("/me", getMe);
router.post("/forgot-password", authIpRateLimit, forgotPassword);
router.post("/reset-password", tokenIpRateLimit, resetPasswordHandler);
router.post("/password", requireAuth, changePassword);
router.post("/invites", requireAuth, requireDispatcher, createInvite);
router.post("/invites/accept", tokenIpRateLimit, acceptInviteHandler);
router.delete("/invites/:userId", requireAuth, requireDispatcher, withdrawInviteHandler);
router.get("/invitations", requireAuth, getInvitations);
router.post("/invitations/:companyId/accept", requireAuth, acceptInvitationHandler);
router.delete("/invitations/:companyId", requireAuth, declineInvitationHandler);
router.get("/members", requireAuth, requireDispatcher, getMembers);
router.get("/audit", requireAuth, requireDispatcher, getAudit);
router.patch("/members/:userId", requireAuth, requireDispatcher, patchMember);
router.delete("/members/:userId", requireAuth, requireDispatcher, deleteMember);
router.post("/companies", requireAuth, createCompany);
router.post("/company", requireAuth, switchCompany);
router.post("/import-prompt/dismiss", requireAuth, dismissImport);
router.get("/security", requireAuth, requireDispatcher, getSecurity);
router.patch("/security", requireAuth, requireDispatcher, patchSecurity);
router.post("/totp/setup", loginIpRateLimit, setupTotp);
router.post("/totp/confirm", loginIpRateLimit, confirmTotp);
router.post("/totp", loginIpRateLimit, confirmTotp);
router.post("/totp/disable", requireAuth, disableTotp);
router.get("/sso/providers", listSsoProviders);
router.post("/sso/company/discover", authIpRateLimit, discoverCompanySso);
router.get("/sso/company/start", ssoStartRateLimit, startCompanySso);
router.post("/sso/link", ssoStartRateLimit, startSsoLink);
router.delete("/sso/links/:provider", requireAuth, unlinkSso);
router.get("/sso/company/callback", finishSso);
router.get("/sso/:provider/start", ssoStartRateLimit, startSso);
router.get("/sso/:provider/callback", finishSso);

export default router;
