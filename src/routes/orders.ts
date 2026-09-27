import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

const REQUIRED_FIELDS = [
  "customerName",
  "customerPhone",
  "itemDescription",
  "riderId",
] as const;

type CreateOrderBody = Record<(typeof REQUIRED_FIELDS)[number], string>;

// POST /orders — vendor creates a delivery order and assigns a rider.
router.post("/", async (req, res) => {
  const body = req.body ?? {};

  const missing = REQUIRED_FIELDS.filter(
    (field) => typeof body[field] !== "string" || body[field].trim() === "",
  );
  if (missing.length > 0) {
    res.status(400).json({
      error: "Missing or empty required fields",
      fields: missing,
    });
    return;
  }

  const { customerName, customerPhone, itemDescription, riderId } =
    Object.fromEntries(
      REQUIRED_FIELDS.map((field) => [field, body[field].trim()]),
    ) as CreateOrderBody;

  const rider = await prisma.rider.findUnique({ where: { id: riderId } });
  if (!rider) {
    res.status(400).json({
      error: "riderId does not match any rider",
      fields: ["riderId"],
    });
    return;
  }

  const order = await prisma.order.create({
    data: { customerName, customerPhone, itemDescription, riderId },
  });

  res.status(201).json(order);
});

export default router;
