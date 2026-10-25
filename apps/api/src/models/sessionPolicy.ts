import { membershipRow } from "./authView";
import { UserModel } from "./user.model";

/** What a login flow or an open session has proven about the person. */
export type SessionProof = {
    /** A second factor (TOTP or a recovery code) was passed. */
    mfa: boolean;
    /** The company whose own login (OIDC) signed the person in, if any. */
    ssoCompanyId: number | null;
};

/**
 * What still keeps a person with this proof out of a company:
 *
 * - `no_membership`: no account or no membership (any more);
 * - `sso_scope`: a company login vouches for its own company only;
 * - `sso_required`: the company requires its own login;
 * - `totp_required`: the company or the account requires a second factor.
 *
 * `null` means nothing does. The same rules hold when a session is opened,
 * on every request of an open session, and when it switches companies.
 */
export type PolicyGap = "no_membership" | "sso_scope" | "sso_required" | "totp_required";

export function policyGap(
    userId: number,
    companyId: number,
    proof: SessionProof,
): PolicyGap | null {
    const user = UserModel.getById(userId);
    const row = user ? membershipRow(userId, companyId) : undefined;

    if (!user || !row) {
        return "no_membership";
    }

    if (proof.ssoCompanyId !== null && proof.ssoCompanyId !== companyId) {
        return "sso_scope";
    }

    if (row.sso_required === 1 && proof.ssoCompanyId !== companyId) {
        return "sso_required";
    }

    if ((row.totp_required === 1 || user.totp_enabled === 1) && !proof.mfa) {
        return "totp_required";
    }

    return null;
}
