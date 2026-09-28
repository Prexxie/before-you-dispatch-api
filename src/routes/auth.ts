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
import { sendEmail } from "../lib/email";
import { RESET_TOKEN_TTL_MS, hashResetToken, newResetToken } from "../lib/resetToken";
import { env } from "../config/env";
import { readGoogleTicket, signGoogleTicket, verifyGoogleCredential } from "../lib/google";
import { Vendor, VendorCategory } from "../generated/prisma/client";

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const VENDOR_CATEGORIES = Object.values(VendorCategory);

function vendorView(vendor: Vendor) {
  return {
    id: vendor.id,
    businessName: vendor.businessName,
    businessAddress: vendor.businessAddress,
    businessPhone: vendor.businessPhone,
    logoUrl: vendor.logoUrl,
    ownerName: vendor.ownerName,
    category: vendor.category,
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
  const businessPhone =
    typeof body.businessPhone === "string" && body.businessPhone.trim()
      ? body.businessPhone.trim()
      : null;
  const logoUrl = parseLogoDataUrl(body.logoDataUrl);
  const ownerName =
    typeof body.ownerName === "string" ? body.ownerName.trim() : "";
  const category = body.category;
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  const fields: string[] = [];
  if (!businessName) fields.push("businessName");
  if (!businessAddress) fields.push("businessAddress");
  if (!ownerName) fields.push("ownerName");
  if (!VENDOR_CATEGORIES.includes(category)) fields.push("category");
  if (!EMAIL_PATTERN.test(email)) fields.push("email");
  if (password.length < MIN_PASSWORD_LENGTH) fields.push("password");
  if (logoUrl === "invalid") fields.push("logoDataUrl");
  if (fields.length > 0) {
    res.status(400).json({
      error: `businessName, businessAddress, ownerName, a valid category and email are required; password must be at least ${MIN_PASSWORD_LENGTH} characters; logoDataUrl, if sent, must be a small image (under 500 KB)`,
      fields,
    });
    return;
  }

  const existing = await prisma.vendor.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({
      error: "An account with this email already exists",
      fields: ["email"],
    });
    return;
  }

  const passwordHash = await hashPassword(password);
  const vendor = await prisma.vendor.create({
    data: {
      businessName,
      businessAddress,
      businessPhone,
      logoUrl,
      ownerName,
      category: category as VendorCategory,
      email,
      passwordHash,
    },
  });

  setSessionCookie(res, vendor.id);
  res.status(201).json(vendorView(vendor));
});

// POST /auth/login — body { email, password }.
router.post("/login", async (req, res) => {
  const body = req.body ?? {};
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  const vendor = email
    ? await prisma.vendor.findUnique({ where: { email } })
    : null;
  const valid =
    vendor?.passwordHash != null && (await verifyPassword(password, vendor.passwordHash));
  if (!vendor || !valid) {
    res.status(401).json({ error: "Incorrect email or password" });
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
  const businessPhone =
    typeof body.businessPhone === "string" && body.businessPhone.trim()
      ? body.businessPhone.trim()
      : null;
  const logoUrl = parseLogoDataUrl(body.logoDataUrl);
  const ownerName =
    typeof body.ownerName === "string" ? body.ownerName.trim() : "";
  const category = body.category;

  const fields: string[] = [];
  if (!businessName) fields.push("businessName");
  if (!businessAddress) fields.push("businessAddress");
  if (!ownerName) fields.push("ownerName");
  if (!VENDOR_CATEGORIES.includes(category)) fields.push("category");
  if (logoUrl === "invalid") fields.push("logoDataUrl");
  if (fields.length > 0) {
    res.status(400).json({
      error:
        "businessName, businessAddress, ownerName and a valid category are required; logoDataUrl, if sent, must be a small image (under 500 KB)",
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

// PATCH /auth/me — the "Edit Profile" form (design: "Vendor: Settings").
// Body: any of { businessName, businessAddress, businessPhone, logoDataUrl,
// ownerName, category }, all optional — only the fields sent are changed.
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
    data.businessPhone =
      typeof body.businessPhone === "string" && body.businessPhone.trim()
        ? body.businessPhone.trim()
        : null;
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
    else data.category = body.category as VendorCategory;
  }

  if (fields.length > 0) {
    res.status(400).json({
      error:
        "businessName, businessAddress and ownerName can't be empty; category must be valid; logoDataUrl, if sent, must be a small image (under 500 KB)",
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

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({
      error: `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`,
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
  if (!EMAIL_PATTERN.test(email)) {
    res.status(400).json({ error: "Enter a valid email address", fields: ["email"] });
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
        subject: "Reset your Before You Dispatch password",
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

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({
      error: `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`,
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
