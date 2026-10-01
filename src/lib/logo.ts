// Vendor logo, stored as a data URL (no object storage set up for this
// build — see prisma/schema.prisma). Kept small: the dashboard shows it at
// avatar size, not full resolution.
const LOGO_DATA_URL_PATTERN = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+=*)$/;
const MAX_LOGO_BYTES = 500_000; // ~500 KB decoded

// Returns the data URL unchanged if it's a small enough image, null if the
// field was left out entirely, or "invalid" if it's present but malformed
// or too large — the caller turns that into a 400.
export function parseLogoDataUrl(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const match = LOGO_DATA_URL_PATTERN.exec(value);
  if (!match) return "invalid";
  // Decoded byte length from the base64 payload, without actually
  // decoding it: 3 bytes per 4 base64 chars, minus any "=" padding.
  const base64 = match[2];
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const decodedBytes = (base64.length / 4) * 3 - padding;
  if (decodedBytes > MAX_LOGO_BYTES) return "invalid";
  return value;
}
