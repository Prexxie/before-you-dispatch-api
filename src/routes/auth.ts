import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
} from "../lib/auth";
import { requireVendor } from "../middleware/requireVendor";
import { Vendor } from "../generated/prisma/client";

const router = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function vendorView(vendor: Vendor) {
  return {
    id: vendor.id,
    businessName: vendor.businessName,
    businessAddress: vendor.businessAddress,
    businessPhone: vendor.businessPhone,
    email: vendor.email,
  };
}

// POST /auth/signup — body { businessName, businessAddress?, businessPhone?,
// email, password }. Address and phone are optional (a vendor can add them
// later); they're what customers and riders see as "delivered from".
router.post("/signup", async (req, res) => {
  const body = req.body ?? {};
  const businessName =
    typeof body.businessName === "string" ? body.businessName.trim() : "";
  const businessAddress =
    typeof body.businessAddress === "string" && body.businessAddress.trim()
      ? body.businessAddress.trim()
      : null;
  const businessPhone =
    typeof body.businessPhone === "string" && body.businessPhone.trim()
      ? body.businessPhone.trim()
      : null;
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  const fields: string[] = [];
  if (!businessName) fields.push("businessName");
  if (!EMAIL_PATTERN.test(email)) fields.push("email");
  if (password.length < MIN_PASSWORD_LENGTH) fields.push("password");
  if (fields.length > 0) {
    res.status(400).json({
      error: `businessName and a valid email are required; password must be at least ${MIN_PASSWORD_LENGTH} characters`,
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
    data: { businessName, businessAddress, businessPhone, email, passwordHash },
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
  const valid = vendor && (await verifyPassword(password, vendor.passwordHash));
  if (!vendor || !valid) {
    res.status(401).json({ error: "Incorrect email or password" });
    return;
  }

  setSessionCookie(res, vendor.id);
  res.json(vendorView(vendor));
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

export default router;
