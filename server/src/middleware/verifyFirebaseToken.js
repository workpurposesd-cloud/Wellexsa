const unauthorizedResponse = Object.freeze({
  error: {
    code: "UNAUTHENTICATED",
    message: "Authentication required."
  }
});

export function createVerifyFirebaseToken(verifyIdToken) {
  if (typeof verifyIdToken !== "function") {
    throw new TypeError("verifyIdToken must be a function.");
  }

  return async function verifyFirebaseToken(request, response, next) {
    const authorization = request.get("authorization");
    const match = typeof authorization === "string"
      ? /^Bearer\s+(\S+)$/i.exec(authorization)
      : null;

    if (!match) {
      response.status(401).json(unauthorizedResponse);
      return;
    }

    try {
      request.auth = await verifyIdToken(match[1], true);
    } catch {
      response.status(401).json(unauthorizedResponse);
      return;
    }

    next();
  };
}

export const verifyFirebaseToken = createVerifyFirebaseToken(async (token, checkRevoked) => {
  const { firebaseAuth } = await import("../config/firebaseAdmin.js");
  return firebaseAuth.verifyIdToken(token, checkRevoked);
});
