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

// Loose check: enough digits to be a real number (E.164 allows up to 15), so
// WhatsApp and SMS links built from it can work. A Nigerian mobile number
// normalizes to 13 digits (234 + 10).
export function isValidPhone(raw: string): boolean {
  const length = normalizePhone(raw).length;
  return length >= 10 && length <= 15;
}
