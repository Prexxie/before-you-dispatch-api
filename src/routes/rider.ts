import { Router } from "express";
import { prisma } from "../lib/prisma";
import { UUID_PATTERN } from "../lib/customerToken";
import { orderLocation } from "../lib/orderView";
import { vendorDetails } from "../config/env";
import { FailureReason, OrderStatus } from "../generated/prisma/client";

// Rider handoff (MVP feature 4). Public, no auth: the unguessable riderToken
// in the rider's link is the only credential.
const router = Router();

const FAILURE_REASONS = Object.values(FailureReason);

// Only orders with a saved pin have a rider link at all.
async function findJob(token: string) {
  if (!UUID_PATTERN.test(token)) return null;
  const order = await prisma.order.findUnique({
    where: { riderToken: token },
    include: { rider: true, vendor: true },
  });
  return order && orderLocation(order) ? order : null;
}

// GET /rider/:token — everything the rider needs in one place: who, what,
// the pin and the landmark note. `location` withheld until the rider has
// confirmed pickup — the pin isn't handed over before that, not just hidden
// in the UI (design: "Rider: Assigned Delivery" shows only the pickup leg).
router.get("/:token", async (req, res) => {
  const order = await findJob(req.params.token);
  if (!order) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }
  res.json({
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    itemDescription: order.itemDescription,
    location: order.pickedUpAt ? orderLocation(order) : null,
    status: order.status,
    failureReason: order.failureReason,
    riderName: order.rider.name,
    vendorName: order.vendor.businessName,
    // The pickup point.
    vendor: vendorDetails(order.vendor),
    pickedUpAt: order.pickedUpAt,
    // Set once the customer taps "I've received my delivery"; the rider can
    // only complete the delivery after that.
    receivedAt: order.receivedAt,
    deliveryConfirmedBy: order.deliveryConfirmedBy,
  });
});

const NOT_PICKUPABLE_MESSAGES: Partial<Record<OrderStatus, string>> = {
  confirmed: "This delivery hasn't been dispatched yet.",
  delivered: "This delivery is already finished.",
  failed: "This delivery is already finished.",
};

// POST /rider/:token/pickup — the rider confirms they've collected the
// order from the vendor. Unlocks the customer's pin and landmark note.
// Tapping again is harmless; not required before marking an outcome (a
// rider who forgets this step can still complete or fail the delivery —
// the gate is on the pin, not on the outcome endpoint).
router.post("/:token/pickup", async (req, res) => {
  const order = await findJob(req.params.token);
  if (!order) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }

  const pickedUpAt = new Date();
  await prisma.order.updateMany({
    where: { id: order.id, status: "dispatched", pickedUpAt: null },
    data: { pickedUpAt },
  });

  const current = await prisma.order.findUnique({ where: { id: order.id } });
  if (!current) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }
  if (current.pickedUpAt === null) {
    res.status(409).json({
      error:
        NOT_PICKUPABLE_MESSAGES[current.status] ??
        "This delivery can't be marked picked up right now.",
      status: current.status,
    });
    return;
  }
  res.json({
    pickedUpAt: current.pickedUpAt,
    location: orderLocation(current),
  });
});

// POST /rider/:token/outcome — { outcome: "delivered" } or
// { outcome: "failed", reason: <FailureReason> }. Once only, while dispatched.
// Delivered (completed) needs the customer's "I've received my delivery"
// first; failed is only possible before that (CLAUDE.md flow step 6).
router.post("/:token/outcome", async (req, res) => {
  const { outcome, reason } = req.body ?? {};
  const delivered = outcome === "delivered";
  const failed = outcome === "failed" && FAILURE_REASONS.includes(reason);
  if (!delivered && !failed) {
    res.status(400).json({
      error: `Send { outcome: "delivered" } or { outcome: "failed", reason } with reason one of: ${FAILURE_REASONS.join(", ")}`,
      fields: outcome === "failed" ? ["reason"] : ["outcome"],
    });
    return;
  }

  const order = await findJob(req.params.token);
  if (!order) {
    res.status(404).json({ error: "Delivery not found" });
    return;
  }

  // Conditional update: two taps (or two phones) can't both record an outcome.
  const status: OrderStatus = delivered ? "delivered" : "failed";
  const { count } = await prisma.order.updateMany({
    where: {
      id: order.id,
      status: "dispatched",
      receivedAt: delivered ? { not: null } : null,
    },
    data: {
      status,
      completedAt: new Date(),
      failureReason: failed ? (reason as FailureReason) : null,
    },
  });

  if (count === 0) {
    const current = await prisma.order.findUnique({ where: { id: order.id } });
    const currentStatus = current?.status ?? order.status;
    const NOT_MARKABLE_MESSAGES: Partial<Record<OrderStatus, string>> = {
      confirmed: "This delivery hasn't been dispatched yet.",
      delivered: "This delivery is already marked as delivered.",
      failed: "This delivery is already marked as failed.",
    };
    let error =
      NOT_MARKABLE_MESSAGES[currentStatus] ??
      "This delivery can't be marked right now.";
    if (currentStatus === "dispatched") {
      error = delivered
        ? "Waiting for the customer to confirm they've received it."
        : "The customer confirmed they received it, so it can't be marked failed.";
    }
    res.status(409).json({ error, status: currentStatus });
    return;
  }

  res.json({ status, failureReason: failed ? reason : null });
});

export default router;
