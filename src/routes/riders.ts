import { Router } from "express";
import { prisma } from "../lib/prisma";
import { isValidPhone } from "../lib/phone";
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
    select: { id: true, name: true, phone: true, vehicle: true, active: true },
    orderBy: { name: "asc" },
  });
  res.json(riders);
});

// POST /riders — add a rider (the vendor's own staff, or a third-party
// dispatch rider they use often). Body: { name, phone, vehicle }.
router.post("/", async (req, res) => {
  const body = req.body ?? {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const vehicle = body.vehicle;

  const fields: string[] = [];
  if (!name) fields.push("name");
  if (!isValidPhone(phone)) fields.push("phone");
  if (!VEHICLES.includes(vehicle)) fields.push("vehicle");
  if (fields.length > 0) {
    res.status(400).json({
      error: "name, a valid phone and a vehicle (bike, car or van) are required",
      fields,
    });
    return;
  }

  const rider = await prisma.rider.create({
    data: { name, phone, vehicle: vehicle as Vehicle, vendorId: req.vendorId },
  });
  res.status(201).json(rider);
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
