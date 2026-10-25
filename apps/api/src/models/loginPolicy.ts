import { companySecurity, hasSsoIdentity, ssoClient } from "./account.model";
import { membershipRow } from "./authView";
import { policyGap, type SessionProof } from "./sessionPolicy";
import { UserModel } from "./user.model";

export type LoginDecision =
    | { kind: "session" }
    | { kind: "totp"; enroll: boolean }
    /** `link`: the person may link the company login now (no link yet, the IdP is set up). */
    | { kind: "sso_required"; link: boolean }
    | { kind: "denied" };

/** The provider key of a company's own login in `sso_identities`. */
export const companyProvider = (companyId: number) => `company:${companyId}`;

/**
 * The one decision before a session exists, for every way in: password,
 * Google, Microsoft, a company login, the second factor, an invite.
 *
 * A second factor is asked before the company login is pointed out, so a
 * person who still has to link the company login has passed every factor
 * first. An identity provider's own MFA does not replace the second factor.
 */
export function decideLogin(
    userId: number,
    companyId: number,
    proof: SessionProof,
): LoginDecision {
    const gap = policyGap(userId, companyId, proof);

    if (gap === null) {
        return { kind: "session" };
    }

    const user = UserModel.getById(userId);
    const row = membershipRow(userId, companyId);

    if (gap === "no_membership" || gap === "sso_scope" || !user || !row) {
        return { kind: "denied" };
    }

    const needsFactor =
        !proof.mfa && (row.totp_required === 1 || user.totp_enabled === 1);

    const issuer = companySecurity(companyId)?.sso_issuer ?? null;

    if (gap === "sso_required" && hasSsoIdentity(userId, companyProvider(companyId), issuer)) {
        return { kind: "sso_required", link: false };
    }

    if (needsFactor) {
        return { kind: "totp", enroll: user.totp_enabled !== 1 };
    }

    return { kind: "sso_required", link: Boolean(ssoClient(companyId)) };
}
