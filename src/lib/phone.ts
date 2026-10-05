// Vendors type phone numbers however they like ("0803 123 4567",
// "+2348031234567", "2348031234567"). This reduces Nigerian numbers to one
// form so the same customer matches across orders.
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) {
    return `234${digits.slice(1)}`;
  }
  // "803 123 4567": the leading 0 left off.
  if (digits.length === 10 && /^[789]/.test(digits)) return `234${digits}`;
  return digits;
}

export const PHONE_ERROR =
  "Enter a valid phone number, like 0803 123 4567 or +234 803 123 4567";

// Phone check for everyone's numbers (vendors, riders, customers). The web
// app has a mirror of this (lib/validate.ts there).
//  - Only digits, spaces, dashes, dots and brackets, with an optional
//    leading "+". Letters and other characters are rejected outright
//    (normalizePhone alone would silently strip them).
//  - Nigerian mobile numbers, written locally (0803 123 4567) or
//    internationally (+234 803 123 4567, 2348031234567): the prefix after 0
//    / 234 is 7, 8 or 9 then 0 or 1, then 8 more digits, so a missing or
//    extra digit is caught.
//  - Any other country: needs an explicit "+", then 8 to 15 digits with no
//    leading 0 (E.164), so WhatsApp and SMS links built from it can work.
const ALLOWED_CHARACTERS = /^\+?[\d\s\-().]+$/;
const NIGERIAN_MOBILE = /^234[789][01]\d{8}$/;

export function isValidPhone(raw: string): boolean {
  const value = raw.trim();
  if (!ALLOWED_CHARACTERS.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  const international = value.startsWith("+");

  if (!international && digits.startsWith("0")) {
    return NIGERIAN_MOBILE.test(normalizePhone(digits));
  }
  if (NIGERIAN_MOBILE.test(digits)) return true;
  // Local form with the leading 0 left off: "803 123 4567".
  if (!international && NIGERIAN_MOBILE.test(`234${digits}`)) return true;
  // 234 is Nigeria's code: a number starting with it that isn't a valid
  // Nigerian mobile number is a typo, not another country's number.
  if (digits.startsWith("234")) return false;
  return international && /^[1-9]\d{7,14}$/.test(digits);
}
