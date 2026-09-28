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
