import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireVendor } from "../middleware/requireVendor";

const router = Router();

// GET /riders — riders the logged-in vendor can assign when creating an
// order. Adding and deactivating riders comes with the riders page (week 2).
router.get("/", requireVendor, async (req, res) => {
  const riders = await prisma.rider.findMany({
    where: { vendorId: req.vendorId },
    select: { id: true, name: true, phone: true, vehicle: true },
    orderBy: { name: "asc" },
  });
  res.json(riders);
});

export default router;
