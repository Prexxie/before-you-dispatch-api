import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
} from "../lib/auth";
import { requireVendor } from "../middleware/requireVendor";
import { parseLogoDataUrl } from "../lib/logo";
import { EMAIL_ERROR, PASSWORD_ERROR, isStrongPassword, isValidEmail } from "../lib/validate";
import { PHONE_ERROR, isValidPhone } from "../lib/phone";
import { sendEmail } from "../lib/email";
import { RESET_TOKEN_TTL_MS, hashResetToken, newResetToken } from "../lib/resetToken";
import { env } from "../config/env";
import { readGoogleTicket, signGoogleTicket, verifyGoogleCredential } from "../lib/google";
import { ThemeColor, Vendor, VendorCategory } from "../generated/prisma/client";

const router = Router();

const VENDOR_CATEGORIES = Object.values(VendorCategory);
const THEME_COLORS = Object.values(ThemeColor);
const MAX_CATEGORY_OTHER_LENGTH = 60;

// Shown when someone tries a password on an account that was made with
// Google and never given one. The web app matches on `code`, not the text.
const GOOGLE_ACCOUNT_ERROR = "This email uses Google sign-in";

// The optional business phone: empty means "none" (null), anything else has
// to be a real phone number. Returns "invalid" for the latter.
function parseBusinessPhone(value: unknown): string | null | "invalid" {
  if (typeof value !== "string" || !value.trim()) return null;
  return isValidPhone(value) ? value.trim() : "invalid";
}

// "other" needs the vendor's own words; every other category clears them.
function parseCategoryOther(category: unknown, value: unknown): string | null | "invalid" {
  if (category !== "other") return null;
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= MAX_CATEGORY_OTHER_LENGTH ? text : "invalid";
}

function vendorView(vendor: Vendor) {
  return {
    id: vendor.id,
    businessName: vendor.businessName,
    businessAddress: vendor.businessAddress,
    businessPhone: vendor.businessPhone,
    logoUrl: vendor.logoUrl,
    ownerName: vendor.ownerName,
    category: vendor.category,
    // The vendor's own words when category is "other"; null otherwise.
    categoryOther: vendor.categoryOther,
    // A per-vendor dashboard accent (design: "Vendor: Settings", Workspace
    // theme). Never sent to customers or riders — vendorDetails() (in
    // config/env.ts) is their separate, public subset and doesn't include it.
    themeColor: vendor.themeColor,
    email: vendor.email,
    // false for an account made with Google that never set a password.
    hasPassword: vendor.passwordHash !== null,
  };
}

// POST /auth/signup — body { businessName, businessAddress, businessPhone?,
// logoDataUrl?, ownerName, category, email, password }. businessAddress is
// the rider's pickup point, required; businessPhone is optional (a vendor
// can add it later). Both are what customers and riders see as "delivered
// from". logoDataUrl is an optional small "data:image/..." string, shown
// only on the vendor's own dashboard for now. ownerName and category are
// account context, never shown to customers or riders.
router.post("/signup", async (req, res) => {
  const body = req.body ?? {};
  const businessName =
    typeof body.businessName === "string" ? body.businessName.trim() : "";
  const businessAddress =
    typeof body.businessAddress === "string" ? body.businessAddress.trim() : "";
  const businessPhone = parseBusinessPhone(body.businessPhone);
  const logoUrl = parseLogoDataUrl(body.logoDataUrl);
  const ownerName =
    typeof body.ownerName === "string" ? body.ownerName.trim() : "";
  const category = body.category;
  const categoryOther = parseCategoryOther(category, body.categoryOther);
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  const fields: string[] = [];
  if (!businessName) fields.push("businessName");
  if (!businessAddress) fields.push("businessAddress");
  if (!ownerName) fields.push("ownerName");
  if (!VENDOR_CATEGORIES.includes(category)) fields.push("category");
  if (categoryOther === "invalid") fields.push("categoryOther");
  if (!isValidEmail(email)) fields.push("email");
  if (!isStrongPassword(password)) fields.push("password");
  if (businessPhone === "invalid") fields.push("businessPhone");
  if (logoUrl === "invalid") fields.push("logoDataUrl");
  if (fields.length > 0) {
    // A bad email gets its own message: it's the field people mistype.
    res.status(400).json({
      error: fields.includes("email")
        ? EMAIL_ERROR
        : fields.includes("password")
          ? PASSWORD_ERROR
          : fields.includes("businessPhone")
          ? PHONE_ERROR
          : `businessName, businessAddress, ownerName, a valid category (with categoryOther when it's "other") and email are required; logoDataUrl, if sent, must be a small image (under 500 KB)`,
      fields,
    });
    return;
  }

  // One account per email, however it was made: a Google account and an
  // email sign-up with the same address are the same account.
  const existing = await prisma.vendor.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({
      error:
        existing.passwordHash === null && existing.googleId
          ? `${GOOGLE_ACCOUNT_ERROR}. Continue with Google, or log in and set a password in Settings.`
          : "An account with this email already exists. Log in instead.",
      code: existing.passwordHash === null && existing.googleId ? "google_account" : "email_taken",
      fields: ["email"],
    });
    return;
  }

  const passwordHash = await hashPassword(password);
  let vendor: Vendor;
  try {
    vendor = await prisma.vendor.create({
      data: {
        businessName,
        businessAddress,
        businessPhone,
        logoUrl,
        ownerName,
        category: category as VendorCategory,
        categoryOther,
        email,
        passwordHash,
      },
    });
  } catch (err) {
    // Two sign-ups with the same email at once: the unique index decides.
    if ((err as { code?: string }).code === "P2002") {
      res.status(409).json({
        error: "An account with this email already exists. Log in instead.",
        code: "email_taken",
        fields: ["email"],
      });
      return;
    }
    throw err;
  }

  setSessionCookie(res, vendor.id);
  res.status(201).json(vendorView(vendor));
});

// POST /auth/login — body { email, password }.
router.post("/login", async (req, res) => {
  const body = req.body ?? {};
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!isValidEmail(email)) {
    res.status(400).json({ error: EMAIL_ERROR, fields: ["email"] });
    return;
  }

  const vendor = await prisma.vendor.findUnique({ where: { email } });
  // Made with Google and never given a password: say so, instead of a
  // "wrong password" they could never fix. (This does tell a caller that the
  // email has a Google account; the same is already visible from sign-up's
  // "email taken" answer.)
  if (vendor && vendor.passwordHash === null) {
    res.status(401).json({ error: GOOGLE_ACCOUNT_ERROR, code: "google_account" });
    return;
  }
  const valid =
    vendor?.passwordHash != null && (await verifyPassword(password, vendor.passwordHash));
  if (!vendor || !valid) {
    res.status(401).json({ error: "Incorrect email or password", code: "invalid_credentials" });
    return;
  }

  setSessionCookie(res, vendor.id);
  res.json(vendorView(vendor));
});

// POST /auth/google — body { credential }, the token from "Sign in with
// Google". Verified with Google, then:
//  - an account already linked to this Google user, or one with the same
//    (Google-verified) email, is signed in -> { status: "signed_in", vendor }
//  - otherwise there's no account yet -> { status: "needs_setup", ticket,
//    email, name }: business details are still needed (POST /auth/google/signup).
router.post("/google", async (req, res) => {
  const credential =
    typeof req.body?.credential === "string" ? req.body.credential : "";
  const identity = credential ? await verifyGoogleCredential(credential) : null;
  if (!identity) {
    res.status(401).json({ error: "Couldn't verify your Google sign-in. Try again." });
    return;
  }

  const vendor =
    (await prisma.vendor.findUnique({ where: { googleId: identity.googleId } })) ??
    (await prisma.vendor.findUnique({ where: { email: identity.email } }));
  if (vendor) {
    // Google vouches for the email, so an existing password account with the
    // same one can be linked safely.
    const linked = vendor.googleId
      ? vendor
      : await prisma.vendor.update({
          where: { id: vendor.id },
          data: { googleId: identity.googleId },
        });
    setSessionCookie(res, linked.id);
    res.json({ status: "signed_in", vendor: vendorView(linked) });
    return;
  }

  res.json({
    status: "needs_setup",
    ticket: signGoogleTicket(identity),
    email: identity.email,
    name: identity.name,
  });
});

// POST /auth/google/signup — the business details for a new Google user.
// Body { ticket, businessName, businessAddress, businessPhone?, logoDataUrl?,
// ownerName, category }. Email comes from the ticket, never the body.
router.post("/google/signup", async (req, res) => {
  const body = req.body ?? {};
  const identity =
    typeof body.ticket === "string" ? readGoogleTicket(body.ticket) : null;
  if (!identity) {
    res.status(400).json({
      error: "Your Google sign-in expired. Start again.",
      fields: ["ticket"],
    });
    return;
  }

  const businessName =
    typeof body.businessName === "string" ? body.businessName.trim() : "";
  const businessAddress =
    typeof body.businessAddress === "string" ? body.businessAddress.trim() : "";
  const businessPhone = parseBusinessPhone(body.businessPhone);
  const logoUrl = parseLogoDataUrl(body.logoDataUrl);
  const ownerName =
    typeof body.ownerName === "string" ? body.ownerName.trim() : "";
  const category = body.category;
  const categoryOther = parseCategoryOther(category, body.categoryOther);

  const fields: string[] = [];
  if (!businessName) fields.push("businessName");
  if (!businessAddress) fields.push("businessAddress");
  if (!ownerName) fields.push("ownerName");
  if (!VENDOR_CATEGORIES.includes(category)) fields.push("category");
  if (categoryOther === "invalid") fields.push("categoryOther");
  if (businessPhone === "invalid") fields.push("businessPhone");
  if (logoUrl === "invalid") fields.push("logoDataUrl");
  if (fields.length > 0) {
    res.status(400).json({
      error: fields.includes("businessPhone")
        ? PHONE_ERROR
        : 'businessName, businessAddress, ownerName and a valid category (with categoryOther when it\'s "other") are required; logoDataUrl, if sent, must be a small image (under 500 KB)',
      fields,
    });
    return;
  }

  const existing = await prisma.vendor.findFirst({
    where: { OR: [{ email: identity.email }, { googleId: identity.googleId }] },
  });
  if (existing) {
    res.status(409).json({
      error: "An account with this email already exists. Log in instead.",
      fields: ["email"],
    });
    return;
  }

  const vendor = await prisma.vendor.create({
    data: {
      businessName,
      businessAddress,
      businessPhone,
      logoUrl,
      ownerName,
      category: category as VendorCategory,
      categoryOther,
      email: identity.email,
      googleId: identity.googleId,
      passwordHash: null,
    },
  });
  setSessionCookie(res, vendor.id);
  res.status(201).json(vendorView(vendor));
});

// POST /auth/logout
router.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

// GET /auth/me — the logged-in vendor, or 401 if there isn't one. Used to
// restore the session on page load and to gate the vendor pages.
router.get("/me", requireVendor, async (req, res) => {
  const vendor = await prisma.vendor.findUnique({
    where: { id: req.vendorId },
  });
  if (!vendor) {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }
  res.json(vendorView(vendor));
});

// PATCH /auth/me — the "Edit Profile" form, plus the "Workspace theme"
// swatch picker, which just sends { themeColor } on its own on each click
// (design: "Vendor: Settings"). Body: any of { businessName, businessAddress,
// businessPhone, logoDataUrl, ownerName, category, themeColor }, all
// optional — only the fields sent are changed.
// businessPhone and logoDataUrl clear to null when sent as an empty string;
// email and password aren't editable here (password has its own route
// below; email isn't editable in this build).
router.patch("/me", requireVendor, async (req, res) => {
  const body = req.body ?? {};
  const data: Record<string, unknown> = {};
  const fields: string[] = [];

  if ("businessName" in body) {
    const businessName =
      typeof body.businessName === "string" ? body.businessName.trim() : "";
    if (!businessName) fields.push("businessName");
    else data.businessName = businessName;
  }
  if ("businessAddress" in body) {
    const businessAddress =
      typeof body.businessAddress === "string" ? body.businessAddress.trim() : "";
    if (!businessAddress) fields.push("businessAddress");
    else data.businessAddress = businessAddress;
  }
  if ("businessPhone" in body) {
    const businessPhone = parseBusinessPhone(body.businessPhone);
    if (businessPhone === "invalid") fields.push("businessPhone");
    else data.businessPhone = businessPhone;
  }
  if ("logoDataUrl" in body) {
    const logoUrl = parseLogoDataUrl(body.logoDataUrl);
    if (logoUrl === "invalid") fields.push("logoDataUrl");
    else data.logoUrl = logoUrl;
  }
  if ("ownerName" in body) {
    const ownerName = typeof body.ownerName === "string" ? body.ownerName.trim() : "";
    if (!ownerName) fields.push("ownerName");
    else data.ownerName = ownerName;
  }
  if ("category" in body) {
    if (!VENDOR_CATEGORIES.includes(body.category)) fields.push("category");
    else {
      const categoryOther = parseCategoryOther(body.category, body.categoryOther);
      if (categoryOther === "invalid") fields.push("categoryOther");
      else {
        data.category = body.category as VendorCategory;
        data.categoryOther = categoryOther;
      }
    }
  }
  if ("themeColor" in body) {
    if (!THEME_COLORS.includes(body.themeColor)) fields.push("themeColor");
    else data.themeColor = body.themeColor as ThemeColor;
  }

  if (fields.length > 0) {
    res.status(400).json({
      error: fields.includes("businessPhone")
        ? PHONE_ERROR
        : "businessName, businessAddress and ownerName can't be empty; category (with categoryOther when it's \"other\") and themeColor must be valid; logoDataUrl, if sent, must be a small image (under 500 KB)",
      fields,
    });
    return;
  }
  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "Nothing to update", fields: [] });
    return;
  }

  const vendor = await prisma.vendor.update({ where: { id: req.vendorId }, data });
  res.json(vendorView(vendor));
});

// POST /auth/change-password — body { currentPassword, newPassword }.
router.post("/change-password", requireVendor, async (req, res) => {
  const body = req.body ?? {};
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!isStrongPassword(newPassword)) {
    res.status(400).json({
      error: PASSWORD_ERROR,
      fields: ["newPassword"],
    });
    return;
  }

  const vendor = await prisma.vendor.findUnique({ where: { id: req.vendorId } });
  if (!vendor) {
    res.status(401).json({ error: "Sign in to continue" });
    return;
  }
  // An account made with Google has no password yet, so there's no current
  // one to check: it can simply set one.
  const valid =
    vendor.passwordHash === null ||
    (await verifyPassword(currentPassword, vendor.passwordHash));
  if (!valid) {
    res.status(401).json({
      error: "Current password is incorrect",
      fields: ["currentPassword"],
    });
    return;
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.vendor.update({ where: { id: vendor.id }, data: { passwordHash } });
  res.json({ message: "Password changed" });
});

// POST /auth/forgot-password — body { email }. Always the same 200, whether
// or not the email has an account, so this can't be used to find out who
// does. If it does, a single-use link valid for an hour is emailed.
router.post("/forgot-password", async (req, res) => {
  const body = req.body ?? {};
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isValidEmail(email)) {
    res.status(400).json({ error: EMAIL_ERROR, fields: ["email"] });
    return;
  }

  const vendor = await prisma.vendor.findUnique({ where: { email } });
  if (vendor) {
    try {
      // One live link at a time: asking again voids the earlier one.
      await prisma.passwordReset.deleteMany({
        where: { vendorId: vendor.id, usedAt: null },
      });
      const { token, tokenHash } = newResetToken();
      await prisma.passwordReset.create({
        data: {
          vendorId: vendor.id,
          tokenHash,
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      const link = `${env.webUrl}/vendor/reset-password?token=${token}`;
      await sendEmail({
        to: vendor.email,
        subject: "Reset your WakaRoute password",
        text: `Hi ${vendor.ownerName},\n\nUse this link to choose a new password. It works once and expires in an hour:\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
        html: `<p>Hi ${escapeHtml(vendor.ownerName)},</p><p>Use this link to choose a new password. It works once and expires in an hour:</p><p><a href="${link}">Reset my password</a></p><p>If you didn't ask for this, you can ignore this email.</p>`,
      });
    } catch (err) {
      // Deliberately not surfaced: telling the caller "sending failed" would
      // reveal that the account exists. It's in the server log instead.
      console.error("forgot-password: could not send reset email", err);
    }
  }

  res.json({
    message: "If that email has an account, a reset link is on its way.",
  });
});

// POST /auth/reset-password — body { token, newPassword }.
router.post("/reset-password", async (req, res) => {
  const body = req.body ?? {};
  const token = typeof body.token === "string" ? body.token : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!isStrongPassword(newPassword)) {
    res.status(400).json({
      error: PASSWORD_ERROR,
      fields: ["newPassword"],
    });
    return;
  }

  const reset = token
    ? await prisma.passwordReset.findUnique({
        where: { tokenHash: hashResetToken(token) },
      })
    : null;
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
    res.status(400).json({
      error: "This reset link is invalid or has expired. Request a new one.",
      fields: ["token"],
    });
    return;
  }

  const passwordHash = await hashPassword(newPassword);
  // Conditional on usedAt still being null, so two taps of the same link
  // can't both win.
  const claimed = await prisma.passwordReset.updateMany({
    where: { id: reset.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) {
    res.status(400).json({
      error: "This reset link is invalid or has expired. Request a new one.",
      fields: ["token"],
    });
    return;
  }
  await prisma.vendor.update({ where: { id: reset.vendorId }, data: { passwordHash } });
  res.json({ message: "Password updated" });
});

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export default router;
