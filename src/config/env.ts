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
  // The business customers and riders see ("from Precious Food Business,
  // 12 Allen Avenue, Ikeja, 0803 214 7765") until vendor accounts exist
  // (week 2). Any left empty is simply not shown.
  demoVendorName: process.env.DEMO_VENDOR_NAME?.trim() || null,
  demoVendorAddress: process.env.DEMO_VENDOR_ADDRESS?.trim() || null,
  demoVendorPhone: process.env.DEMO_VENDOR_PHONE?.trim() || null,
};

// Vendor details as the API returns them (null when no name is set).
export function vendorDetails() {
  if (!env.demoVendorName) return null;
  return {
    name: env.demoVendorName,
    address: env.demoVendorAddress,
    phone: env.demoVendorPhone,
  };
}
