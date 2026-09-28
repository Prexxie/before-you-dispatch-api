import { Router } from "express";
import { prisma } from "../lib/prisma";
import { isValidPhone } from "../lib/phone";
import { vendorOrderView } from "../lib/orderView";
import { OrderStatus } from "../generated/prisma/client";
import { startOfLagosDay } from "../lib/lagosDay";
import { env, vendorDetails } from "../config/env";

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

const ORDER_STATUSES = Object.values(OrderStatus);
const PAGE_SIZE = 20;

const STATUS_COUNT_KEY: Record<OrderStatus, string> = {
  pending_confirmation: "awaitingConfirmation",
  confirmed: "confirmed",
  not_ready: "notReady",
  dispatched: "outForDelivery",
  delivered: "delivered",
  failed: "failed",
};

// GET /orders — every order (not just today's — a vendor with a handful of
// orders this week shouldn't see an empty dashboard because none of them
// landed today), most recently active first (any status change bumps an
// order back to the top), paginated. `?status=` narrows to one status;
// `?page=` (1-based) selects a page of PAGE_SIZE.
//
// `counts` is all-time, for the filter chips: independent of the current
// page or filter, so every chip always shows its true total. `today` is a
// separate, always-today snapshot for the stat tiles at the top, since
// those are explicitly labelled "today" in the design.
router.get("/", async (req, res) => {
  const statusParam = req.query.status;
  if (
    typeof statusParam === "string" &&
    !ORDER_STATUSES.includes(statusParam as OrderStatus)
  ) {
    res.status(400).json({
      error: `status must be one of: ${ORDER_STATUSES.join(", ")}`,
      fields: ["status"],
    });
    return;
  }
  const status = statusParam as OrderStatus | undefined;
  const where = status ? { status } : {};

  const pageParam = Number(req.query.page);
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const [total, orders, statusGroups, todayOrders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: { rider: true },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.order.findMany({
      where: { createdAt: { gte: startOfLagosDay() } },
      select: { status: true },
    }),
  ]);

  const counts: Record<string, number> = {
    total: 0,
    awaitingConfirmation: 0,
    confirmed: 0,
    notReady: 0,
    outForDelivery: 0,
    delivered: 0,
    failed: 0,
  };
  for (const g of statusGroups) {
    counts[STATUS_COUNT_KEY[g.status]] = g._count._all;
    counts.total += g._count._all;
  }
  const todayCount = (s: OrderStatus) =>
    todayOrders.filter((o) => o.status === s).length;

  res.json({
    vendorName: env.demoVendorName,
    vendor: vendorDetails(),
    today: {
      total: todayOrders.length,
      awaitingConfirmation: todayCount("pending_confirmation"),
      outForDelivery: todayCount("dispatched"),
      delivered: todayCount("delivered"),
    },
    counts,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      itemDescription: o.itemDescription,
      riderName: o.rider.name,
      status: o.status,
      hasLocation: o.lat != null,
      pickedUpAt: o.pickedUpAt,
      receivedAt: o.receivedAt,
      failureReason: o.failureReason,
      deliveryConfirmedBy: o.deliveryConfirmedBy,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    })),
  });
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

// POST /orders/:id/delivered — the vendor marks a dispatched order delivered
// when the customer can't confirm it themselves (no data, phone off, a
// neighbour took it). Records who confirmed receipt: the customer if they
// already tapped "I've received my delivery", otherwise the vendor.
router.post("/:id/delivered", async (req, res) => {
  const order = await findVendorOrder(req.params.id);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const { count } = await prisma.order.updateMany({
    where: { id: order.id, status: "dispatched" },
    data: {
      status: "delivered",
      completedAt: new Date(),
      deliveryConfirmedBy: order.receivedAt ? "customer" : "vendor",
    },
  });

  const current = await findVendorOrder(order.id);
  if (!current) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (count === 0) {
    res.status(409).json({
      error:
        current.status === "delivered" || current.status === "failed"
          ? "This delivery is already finished."
          : "Only a dispatched order can be marked delivered.",
      status: current.status,
    });
    return;
  }
  res.json(vendorOrderView(current));
});

export default router;
