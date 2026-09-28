import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT) || 4000,
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL ?? "",
  termiiApiKey: process.env.TERMII_API_KEY ?? "",
  // Business name customers see ("... from Precious Food Business") until
  // vendor accounts exist (week 2). Empty means the page leaves it out.
  demoVendorName: process.env.DEMO_VENDOR_NAME?.trim() || null,
};
