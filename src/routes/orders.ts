import { randomUUID } from "node:crypto";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { PHONE_ERROR, isValidPhone } from "../lib/phone";
import { vendorOrderView } from "../lib/orderView";
import { OrderStatus } from "../generated/prisma/client";
import { startOfLagosDay } from "../lib/lagosDay";
import { requireVendor } from "../middleware/requireVendor";
import { vendorDetails } from "../config/env";

const router = Router();

// Applied per-route below, not as a router-wide router.use(): this router,
// confirm.ts and location.ts are all mounted at the same "/orders" prefix in
// routes/index.ts, so a blanket .use() here would also run (and 401) on
// requests actually meant for confirm.ts/location.ts's public,
// token-authenticated routes before Express gets to matching those routers.

const REQUIRED_FIELDS = [
  "customerName",
  "customerPhone",
  "itemDescription",
  "riderId",
] as const;

type CreateOrderBody = Record<(typeof REQUIRED_FIELDS)[number], string>;

// POST /orders — vendor creates a delivery order and assigns a rider (one of
// their own — riderId is checked against the logged-in vendor).
router.post("/", requireVendor, async (req, res) => {
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
      error: PHONE_ERROR,
      fields: ["customerPhone"],
    });
    return;
  }

  const rider = await prisma.rider.findUnique({ where: { id: riderId } });
  if (!rider || rider.vendorId !== req.vendorId || !rider.active) {
    res.status(400).json({
      error: "riderId does not match any rider",
      fields: ["riderId"],
    });
    return;
  }

  const order = await prisma.order.create({
    data: {
      customerName,
      customerPhone,
      itemDescription,
      riderId,
      vendorId: req.vendorId,
    },
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
router.get("/", requireVendor, async (req, res) => {
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
  const where = status
    ? { status, vendorId: req.vendorId }
    : { vendorId: req.vendorId };

  const pageParam = Number(req.query.page);
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const [vendor, total, orders, statusGroups, todayOrders] = await Promise.all([
    prisma.vendor.findUniqueOrThrow({ where: { id: req.vendorId } }),
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: { rider: true },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.order.groupBy({
      by: ["status"],
      where: { vendorId: req.vendorId },
      _count: { _all: true },
    }),
    prisma.order.findMany({
      where: { vendorId: req.vendorId, createdAt: { gte: startOfLagosDay() } },
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
    vendorName: vendor.businessName,
    vendor: vendorDetails(vendor),
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
      arrivedAt: o.arrivedAt,
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

function findVendorOrder(id: string, vendorId: string) {
  if (!ORDER_ID_PATTERN.test(id)) return null;
  return prisma.order.findFirst({
    where: { id, vendorId },
    include: {
      rider: true,
      vendor: true,
      attempts: { include: { rider: true }, orderBy: { attemptNumber: "asc" } },
    },
  });
}

// The rider for the next attempt: the same one unless the vendor picks
// another, who must be one of theirs and still active (same rule as creating
// an order). Returns the rider id, or null if the pick isn't valid.
async function nextRiderId(
  vendorId: string,
  currentRiderId: string,
  requested: unknown,
): Promise<string | null> {
  if (requested === undefined || requested === null || requested === "") {
    return currentRiderId;
  }
  if (typeof requested !== "string") return null;
  const rider = await prisma.rider.findUnique({ where: { id: requested } });
  return rider && rider.vendorId === vendorId && rider.active ? rider.id : null;
}

// What resets when an order goes back to "awaiting confirmation" with a new
// link: the old customer and rider links stop working (new tokens), and every
// step of the previous attempt is cleared. The customer's pin on the order is
// cleared too, so they re-confirm it; their remembered pin still preloads.
function freshStart(riderId: string) {
  return {
    status: "pending_confirmation" as const,
    riderId,
    customerToken: randomUUID(),
    riderToken: randomUUID(),
    confirmedAt: null,
    notReadyAt: null,
    dispatchedAt: null,
    pickedUpAt: null,
    arrivedAt: null,
    receivedAt: null,
    completedAt: null,
    failureReason: null,
    failureNote: null,
    deliveryConfirmedBy: null,
    lat: null,
    lng: null,
    landmarkNote: null,
    locationAddress: null,
    locationSavedAt: null,
    retriggeredAt: null,
  };
}

// GET /orders/:id — one order as the vendor sees it (full details, rider,
// pin, and the rider's link token once the pin is saved). 404s for another
// vendor's order, same as one that doesn't exist.
router.get("/:id", requireVendor, async (req, res) => {
  const order = await findVendorOrder(req.params.id as string, req.vendorId);
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

// PATCH /orders/:id — body { customerName?, customerPhone?, itemDescription? }.
// Fixes a typo before the customer has answered: only while the order is
// still awaiting their confirmation. A changed phone number also replaces the
// customer link, so a link already sent to the wrong number stops working.
router.patch("/:id", requireVendor, async (req, res) => {
  const order = await findVendorOrder(req.params.id as string, req.vendorId);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const body = req.body ?? {};
  const fields = ["customerName", "customerPhone", "itemDescription"] as const;
  const empty = fields.filter(
    (f) => f in body && (typeof body[f] !== "string" || body[f].trim() === ""),
  );
  if (empty.length > 0) {
    res.status(400).json({ error: "Fields can't be empty", fields: empty });
    return;
  }
  const changes: Partial<Record<(typeof fields)[number], string>> = {};
  for (const f of fields) if (f in body) changes[f] = body[f].trim();
  if (changes.customerPhone !== undefined && !isValidPhone(changes.customerPhone)) {
    res.status(400).json({ error: PHONE_ERROR, fields: ["customerPhone"] });
    return;
  }

  const phoneChanged =
    changes.customerPhone !== undefined && changes.customerPhone !== order.customerPhone;
  const { count } = await prisma.order.updateMany({
    where: { id: order.id, status: "pending_confirmation" },
    data: { ...changes, ...(phoneChanged ? { customerToken: randomUUID() } : {}) },
  });
  const current = await findVendorOrder(order.id, req.vendorId);
  if (!current) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (count === 0) {
    res.status(409).json({
      error: "Details can only be changed before the customer answers.",
      status: current.status,
    });
    return;
  }
  res.json(vendorOrderView(current));
});

// PATCH /orders/:id/rider — body { riderId }. The vendor changes the rider
// any time before the order leaves with them: while awaiting the customer,
// confirmed, or dispatched but not yet picked up. The customer's link is
// untouched; the rider link is always replaced, so a link already sent or
// copied for the previous rider stops working. A dispatched order goes back
// to confirmed: the new rider hasn't been sent their link yet.
router.patch("/:id/rider", requireVendor, async (req, res) => {
  const order = await findVendorOrder(req.params.id as string, req.vendorId);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (typeof req.body?.riderId !== "string" || req.body.riderId === "") {
    res.status(400).json({ error: "riderId is required", fields: ["riderId"] });
    return;
  }
  const riderId = await nextRiderId(req.vendorId, order.riderId, req.body.riderId);
  if (!riderId) {
    res.status(400).json({ error: "riderId does not match any rider", fields: ["riderId"] });
    return;
  }

  const same = riderId === order.riderId;
  const swap = { riderId, riderToken: randomUUID() };
  // Two conditional updates so a pickup landing in between can't be undone.
  const notSent = await prisma.order.updateMany({
    where: { id: order.id, status: { in: ["pending_confirmation", "confirmed"] } },
    data: same ? {} : swap,
  });
  const sent =
    notSent.count === 0
      ? await prisma.order.updateMany({
          where: { id: order.id, status: "dispatched", pickedUpAt: null },
          data: same ? {} : { ...swap, status: "confirmed", dispatchedAt: null },
        })
      : { count: 0 };
  const current = await findVendorOrder(order.id, req.vendorId);
  if (!current) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (notSent.count === 0 && sent.count === 0) {
    res.status(409).json({
      error:
        current.status === "dispatched"
          ? "The rider has already picked up the order, so it can't go to a different rider now."
          : "The rider can only be changed before they pick up the order.",
      status: current.status,
    });
    return;
  }
  res.json(vendorOrderView(current));
});

// POST /orders/:id/dispatch — the vendor sent the rider their link, so the
// rider is on the way. Only for confirmed orders with a saved pin: the core
// confirm-before-dispatch rule. Sending again once dispatched is fine.
router.post("/:id/dispatch", requireVendor, async (req, res) => {
  const order = await findVendorOrder(req.params.id as string, req.vendorId);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const { count } = await prisma.order.updateMany({
    where: { id: order.id, status: "confirmed", lat: { not: null } },
    data: { status: "dispatched", dispatchedAt: new Date() },
  });

  const current = await findVendorOrder(order.id, req.vendorId);
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
router.post("/:id/delivered", requireVendor, async (req, res) => {
  const order = await findVendorOrder(req.params.id as string, req.vendorId);
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

  const current = await findVendorOrder(order.id, req.vendorId);
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

// POST /orders/:id/retrigger — body { riderId? }. For an order the customer
// declined ("Not now" + confirmed the warning): issues a NEW customer link
// and puts the order back to awaiting confirmation for a fresh start. The
// vendor sends the new link (customerToken in the response); the old one
// stays closed. The vendor decides the delivery is going out today.
router.post("/:id/retrigger", requireVendor, async (req, res) => {
  const order = await findVendorOrder(req.params.id as string, req.vendorId);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const riderId = await nextRiderId(req.vendorId, order.riderId, req.body?.riderId);
  if (!riderId) {
    res.status(400).json({ error: "riderId does not match any rider", fields: ["riderId"] });
    return;
  }

  const { count } = await prisma.order.updateMany({
    where: { id: order.id, status: "not_ready" },
    data: { ...freshStart(riderId), retriggeredAt: new Date() },
  });
  const current = await findVendorOrder(order.id, req.vendorId);
  if (!current) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (count === 0) {
    res.status(409).json({
      error: "Only an order the customer declined can be retriggered.",
      status: current.status,
    });
    return;
  }
  res.json(vendorOrderView(current));
});

// POST /orders/:id/redeliver — body { riderId? }. For an order the rider
// marked failed: keeps that attempt in the order's history, then resets the
// order for another go with NEW customer and rider links. The customer has to
// confirm they're ready again (a failed trip is often about that), but their
// remembered pin and address preload. Vendor-triggered, not a customer
// reschedule link (CLAUDE.md defers those).
router.post("/:id/redeliver", requireVendor, async (req, res) => {
  const order = await findVendorOrder(req.params.id as string, req.vendorId);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const riderId = await nextRiderId(req.vendorId, order.riderId, req.body?.riderId);
  if (!riderId) {
    res.status(400).json({ error: "riderId does not match any rider", fields: ["riderId"] });
    return;
  }

  const redelivered = await prisma.$transaction(async (tx) => {
    // Conditional on status so two taps can't both record the attempt.
    const { count } = await tx.order.updateMany({
      where: { id: order.id, status: "failed" },
      data: { ...freshStart(riderId), attempt: { increment: 1 } },
    });
    if (count === 0) return false;
    await tx.orderAttempt.create({
      data: {
        orderId: order.id,
        attemptNumber: order.attempt,
        riderId: order.riderId,
        failureReason: order.failureReason,
        failureNote: order.failureNote,
        dispatchedAt: order.dispatchedAt,
        pickedUpAt: order.pickedUpAt,
        arrivedAt: order.arrivedAt,
        failedAt: order.completedAt,
        lat: order.lat,
        lng: order.lng,
        landmarkNote: order.landmarkNote,
        address: order.locationAddress,
      },
    });
    return true;
  });

  const current = await findVendorOrder(order.id, req.vendorId);
  if (!current) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (!redelivered) {
    res.status(409).json({
      error: "Only an order the rider marked as failed can be redelivered.",
      status: current.status,
    });
    return;
  }
  res.json(vendorOrderView(current));
});

export default router;
