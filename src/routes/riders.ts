import { Router } from "express";
import { prisma } from "../lib/prisma";
import { PHONE_ERROR, isValidPhone } from "../lib/phone";
import { parseLogoDataUrl } from "../lib/logo";
import { requireVendor } from "../middleware/requireVendor";
import { Vehicle } from "../generated/prisma/client";

const router = Router();

router.use(requireVendor);

const VEHICLES = Object.values(Vehicle);

// GET /riders — the logged-in vendor's riders, sorted by name.
// ?active=true narrows to riders who can still be assigned (the
// create-order dropdown uses this); with no filter, every rider including
// deactivated ones (the riders management page, which shows both).
router.get("/", async (req, res) => {
  const activeParam = req.query.active;
  const where =
    activeParam === "true"
      ? { vendorId: req.vendorId, active: true }
      : { vendorId: req.vendorId };
  const riders = await prisma.rider.findMany({
    where,
    select: {
      id: true,
      name: true,
      phone: true,
      vehicle: true,
      photoUrl: true,
      active: true,
    },
    orderBy: { name: "asc" },
  });
  res.json(riders);
});

// POST /riders — add a rider (the vendor's own staff, or a third-party
// dispatch rider they use often). Body: { name, phone, vehicle, photoDataUrl? }.
// photoDataUrl is an optional small "data:image/..." string, same rules as
// the vendor logo (under 500 KB).
router.post("/", async (req, res) => {
  const body = req.body ?? {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const vehicle = body.vehicle;
  const photoUrl = parseLogoDataUrl(body.photoDataUrl);

  const fields: string[] = [];
  if (!name) fields.push("name");
  if (!isValidPhone(phone)) fields.push("phone");
  if (!VEHICLES.includes(vehicle)) fields.push("vehicle");
  if (photoUrl === "invalid") fields.push("photoDataUrl");
  if (fields.length > 0) {
    res.status(400).json({
      error: riderFieldsError(fields),
      fields,
    });
    return;
  }

  const rider = await prisma.rider.create({
    data: {
      name,
      phone,
      vehicle: vehicle as Vehicle,
      photoUrl: photoUrl === "invalid" ? null : photoUrl,
      vendorId: req.vendorId,
    },
  });
  res.status(201).json(rider);
});

function riderFieldsError(fields: string[]): string {
  if (fields.length === 1 && fields[0] === "phone") return PHONE_ERROR;
  if (fields.length === 1 && fields[0] === "photoDataUrl") {
    return "photoDataUrl, if sent, must be a small image (under 500 KB)";
  }
  return "name, a valid phone and a vehicle (bike, car or van) are required; photoDataUrl, if sent, must be a small image (under 500 KB)";
}

// PATCH /riders/:id — edit a rider's details. Body: any of { name, phone,
// vehicle, photoDataUrl }, all optional; only the fields sent change.
// photoDataUrl clears to null when sent as an empty string. Doesn't touch
// `active` (the activate/deactivate routes below own that) or past orders.
router.patch("/:id", async (req, res) => {
  const rider = await findVendorRider(req.params.id, req.vendorId);
  if (!rider) {
    res.status(404).json({ error: "Rider not found" });
    return;
  }

  const body = req.body ?? {};
  const data: { name?: string; phone?: string; vehicle?: Vehicle; photoUrl?: string | null } = {};
  const fields: string[] = [];

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) fields.push("name");
    else data.name = name;
  }
  if ("phone" in body) {
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!isValidPhone(phone)) fields.push("phone");
    else data.phone = phone;
  }
  if ("vehicle" in body) {
    if (!VEHICLES.includes(body.vehicle)) fields.push("vehicle");
    else data.vehicle = body.vehicle as Vehicle;
  }
  if ("photoDataUrl" in body) {
    const photoUrl = parseLogoDataUrl(body.photoDataUrl);
    if (photoUrl === "invalid") fields.push("photoDataUrl");
    else data.photoUrl = photoUrl;
  }

  if (fields.length > 0) {
    res.status(400).json({ error: riderFieldsError(fields), fields });
    return;
  }
  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "Nothing to update", fields: [] });
    return;
  }

  const updated = await prisma.rider.update({ where: { id: rider.id }, data });
  res.json(updated);
});

async function findVendorRider(id: string, vendorId: string) {
  return prisma.rider.findFirst({ where: { id, vendorId } });
}

// POST /riders/:id/deactivate — drops the rider from the "Assign a rider"
// list without touching their order history. Sending again is fine.
router.post("/:id/deactivate", async (req, res) => {
  const rider = await findVendorRider(req.params.id, req.vendorId);
  if (!rider) {
    res.status(404).json({ error: "Rider not found" });
    return;
  }
  const updated = await prisma.rider.update({
    where: { id: rider.id },
    data: { active: false },
  });
  res.json(updated);
});

// POST /riders/:id/activate — the reverse: a rider works with this vendor
// again. Sending again is fine.
router.post("/:id/activate", async (req, res) => {
  const rider = await findVendorRider(req.params.id, req.vendorId);
  if (!rider) {
    res.status(404).json({ error: "Rider not found" });
    return;
  }
  const updated = await prisma.rider.update({
    where: { id: rider.id },
    data: { active: true },
  });
  res.json(updated);
});

export default router;
