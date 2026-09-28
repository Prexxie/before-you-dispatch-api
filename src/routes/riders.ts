import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

// GET /riders — riders the vendor can assign when creating an order.
// Adding and deactivating riders comes with the riders page (week 2).
router.get("/", async (_req, res) => {
  const riders = await prisma.rider.findMany({
    select: { id: true, name: true, phone: true, vehicle: true },
    orderBy: { name: "asc" },
  });
  res.json(riders);
});

export default router;
