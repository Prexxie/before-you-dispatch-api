import { Router } from "express";
import { prisma } from "../lib/prisma";
import { isValidPhone } from "../lib/phone";
import { vendorOrderView } from "../lib/orderView";
import { OrderStatus } from "../generated/prisma/client";

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

  if (!isValidPhone(customerPhone)) {
    res.status(400).json({
      error: "customerPhone must be a phone number, e.g. 0803 123 4567",
      fields: ["customerPhone"],
    });
    return;
  }

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

// Order ids are cuids; anything else is a customer token or junk.
const ORDER_ID_PATTERN = /^c[a-z0-9]{20,32}$/;

function findVendorOrder(id: string) {
  if (!ORDER_ID_PATTERN.test(id)) return null;
  return prisma.order.findUnique({ where: { id }, include: { rider: true } });
}

// GET /orders/:id — one order as the vendor sees it (full details, rider,
// pin, and the rider's link token once the pin is saved).
router.get("/:id", async (req, res) => {
  const order = await findVendorOrder(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  res.json(vendorOrderView(order));
});

const NOT_DISPATCHABLE_MESSAGES: Partial<Record<OrderStatus, string>> = {
  pending_confirmation: "The customer hasn't confirmed they're ready yet.",
  not_ready: "The customer said they're not ready today.",
  delivered: "This delivery is already finished.",
  failed: "This delivery is already finished.",
};

// POST /orders/:id/dispatch — the vendor sent the rider their link, so the
// rider is on the way. Only for confirmed orders with a saved pin: the core
// confirm-before-dispatch rule. Sending again once dispatched is fine.
router.post("/:id/dispatch", async (req, res) => {
  const order = await findVendorOrder(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const { count } = await prisma.order.updateMany({
    where: { id: order.id, status: "confirmed", lat: { not: null } },
    data: { status: "dispatched", dispatchedAt: new Date() },
  });

  const current = await findVendorOrder(order.id);
  if (!current) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (count === 0 && current.status !== "dispatched") {
    res.status(409).json({
      error:
        NOT_DISPATCHABLE_MESSAGES[current.status] ??
        "The customer hasn't shared their location yet.",
      status: current.status,
    });
    return;
  }
  res.json(vendorOrderView(current));
});

export default router;
