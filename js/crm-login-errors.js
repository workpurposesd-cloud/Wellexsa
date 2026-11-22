export function crmLoginErrorMessage(error, role) {
  const code = typeof error?.code === "string" ? error.code : "";
  const detail = typeof error?.message === "string" ? error.message.toLowerCase() : "";

  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found",
    "auth/invalid-email", "auth/invalid-login-credentials"].includes(code)) {
    return "Incorrect email or password.";
  }
  if (code === "auth/user-disabled") {
    return "This Firebase account is disabled. Contact the Owner.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Email and password sign-in is disabled in Firebase Authentication. Contact the system administrator.";
  }
  if (code === "auth/unauthorized-domain") {
    return "This website domain is not authorized in Firebase Authentication. Ask the administrator to add it under Authorized domains.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many sign-in attempts. Wait a little and try again.";
  }
  if (code === "auth/network-request-failed" || code === "functions/unavailable" ||
      code === "functions/deadline-exceeded" || code === "functions/internal" ||
      code === "functions/unknown") {
    return "Firebase could not verify your sign-in. Check your connection and try again.";
  }
  if (code === "functions/not-found") {
    return role === "owner"
      ? "Owner access is not configured for this account. Contact the system administrator."
      : "CRM access is not configured for this account. Contact the Owner.";
  }
  if (code === "functions/failed-precondition") {
    if (detail.includes("verify") || detail.includes("email")) {
      return "Verify your email using the link we sent, then sign in again.";
    }
    if (detail.includes("sign out") || detail.includes("sign in again")) {
      return "Access was recently changed. Sign out and sign in again to activate this session.";
    }
    if (detail.includes("auth_time") || detail.includes("authentication-time")) {
      return "CRM access needs an authentication-time threshold. Contact the Owner to repair the access record.";
    }
    return "CRM access is not ready yet. Contact the Owner.";
  }
  if (code === "functions/permission-denied") {
    if (detail.includes("inactive") || detail.includes("disabled")) {
      return "CRM access is inactive. Contact the Owner.";
    }
    if (detail.includes("sign out") || detail.includes("sign in again")) {
      return "Access was recently changed. Sign in again to activate this session.";
    }
    if (detail.includes("role") || detail.includes("owner access")) {
      return role === "owner"
        ? "This account is not authorized as a CRM Owner."
        : "This account is not authorized for the CRM Staff workspace.";
    }
    if (detail.includes("permission")) {
      return "This account does not have the required CRM permissions. Contact the Owner.";
    }
    return "This account does not have permission to access this CRM workspace.";
  }
  if (code === "functions/unauthenticated") {
    return "Your sign-in could not be verified. Check your email and password, then try again.";
  }
  return "Sign-in could not be completed. Check your details and try again.";
}

export function crmRoleMismatchMessage(expectedRole, actualRole) {
  if (expectedRole === "owner" && actualRole === "staff") {
    return "Staff accounts cannot access the Owner workspace. Use Staff sign-in.";
  }
  if (expectedRole === "staff" && actualRole === "owner") {
    return "Owner accounts must use Owner sign-in.";
  }
  return "This account is not authorized for this CRM workspace.";
}
