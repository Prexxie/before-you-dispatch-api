// Email format check shared by sign-up, log-in and forgot-password. The web
// app has a mirror of this (lib/validate.ts there) so the form can say so
// before a request is sent; this one is the one that counts.
//
// Rules: one "@"; no spaces; a local part of letters, digits and the usual
// . _ % + - (no leading, trailing or doubled dots); a domain of dot-separated
// labels (letters, digits, hyphens, none starting or ending with a hyphen)
// and a final label of at least two letters, so "a@b", "a@b." and "a@b.c"
// are all rejected. Max 254 characters, per the email standard.
const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export const EMAIL_ERROR = "Enter a valid email address, like name@example.com";

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

// Strong-password rule for choosing a password (sign-up, reset, change). Log-in
// deliberately doesn't use it, so accounts made before the rule still get in.
// The web app has a mirror (lib/validate.ts there) that also drives the live
// checklist under the field.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72; // bcrypt ignores anything past 72 bytes
export const PASSWORD_ERROR =
  "Password must be at least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol";

export function isStrongPassword(password: string): boolean {
  return (
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9\s]/.test(password)
  );
}
