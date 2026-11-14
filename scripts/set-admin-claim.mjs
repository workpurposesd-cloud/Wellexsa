import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const email = process.argv[2]?.trim();
if (!email || !email.includes("@")) {
  console.error("Usage: npm run set-admin -- administrator@example.com");
  process.exitCode = 1;
} else {
  try {
    initializeApp({ credential: applicationDefault() });
    const auth = getAuth();
    const user = await auth.getUserByEmail(email);
    await auth.setCustomUserClaims(user.uid, { ...user.customClaims, admin: true });
    console.log(`Administrator access enabled for ${email}. Have the user sign out and sign back in to refresh the claim.`);
  } catch (error) {
    console.error("Could not grant administrator access:", error.message);
    process.exitCode = 1;
  }
}
