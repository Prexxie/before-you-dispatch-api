import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL ?? "",
  termiiApiKey: process.env.TERMII_API_KEY ?? "",
  // Signs the vendor session cookie. Must be set (and kept secret) outside
  // local dev — a guessable fallback would let anyone forge a session.
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-insecure-secret",
  // Password-reset emails go out over Brevo's HTTPS API (SMTP ports are
  // blocked on some hosts, HTTPS never is). With no key set, the reset link
  // is printed to the API console instead — local dev needs no setup.
  emailApiKey: process.env.EMAIL_API_KEY ?? "",
  // Must be a sender address verified in Brevo.
  emailFrom: process.env.EMAIL_FROM ?? "",
  // The OAuth client ID from Google Cloud (a public value, not the secret;
  // this flow never uses the client secret). Empty disables Google sign-in.
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  // Where the web app lives, for links inside emails. Not CORS_ORIGIN: that
  // can list several origins and isn't guaranteed to be the public one.
  webUrl: (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, ""),
};

if (env.nodeEnv === "production" && env.jwtSecret === "dev-only-insecure-secret") {
  throw new Error("JWT_SECRET must be set in production");
}

// The business a delivery is from, as the API returns it to customers and
// riders. Comes from the logged-in vendor's account (see src/lib/auth.ts
// and src/routes/auth.ts) — no longer a single shared env setting.
export function vendorDetails(vendor: {
  businessName: string;
  businessAddress: string | null;
  businessPhone: string | null;
  logoUrl: string | null;
}) {
  return {
    name: vendor.businessName,
    address: vendor.businessAddress,
    phone: vendor.businessPhone,
    logoUrl: vendor.logoUrl,
  };
}
