// Vendors type phone numbers however they like ("0803 123 4567",
// "+2348031234567", "2348031234567"). This reduces Nigerian numbers to one
// form so the same customer matches across orders.
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) {
    return `234${digits.slice(1)}`;
  }
  return digits;
}
