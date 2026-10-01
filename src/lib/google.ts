import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export type GoogleIdentity = { googleId: string; email: string; name: string };

// Checks a "Sign in with Google" credential: signature, audience (must be
// OUR client ID, so a token minted for some other app is refused), expiry,
// and that Google itself vouches for the email. Returns null if any fails.
export async function verifyGoogleCredential(
  credential: string,
): Promise<GoogleIdentity | null> {
  if (!env.googleClientId) return null;
  try {
    const client = new OAuth2Client(env.googleClientId);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: env.googleClientId,
    });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email || !p.email_verified) return null;
    return { googleId: p.sub, email: p.email.toLowerCase(), name: p.name ?? "" };
  } catch {
    return null;
  }
}

// A brand-new Google user still has to give business details before an
// account exists. This short-lived signed ticket carries the identity Google
// verified between the two steps, so the second step can't be pointed at
// someone else's email.
const TICKET_PURPOSE = "google-signup";

export function signGoogleTicket(identity: GoogleIdentity): string {
  return jwt.sign({ ...identity, purpose: TICKET_PURPOSE }, env.jwtSecret, {
    expiresIn: "15m",
  });
}

export function readGoogleTicket(ticket: string): GoogleIdentity | null {
  try {
    const p = jwt.verify(ticket, env.jwtSecret) as GoogleIdentity & { purpose?: string };
    if (p.purpose !== TICKET_PURPOSE) return null;
    return { googleId: p.googleId, email: p.email, name: p.name };
  } catch {
    return null;
  }
}
