import { Router } from "express";
import { prisma } from "../lib/prisma";
import { UUID_PATTERN } from "../lib/customerToken";
import { orderLocation } from "../lib/orderView";
import { env } from "../config/env";
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
    include: { rider: true },
  });
  return order && orderLocation(order) ? order : null;
}

// GET /rider/:token — everything the rider needs in one place: who, what,
// the pin and the landmark note.
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
    location: orderLocation(order),
    status: order.status,
    failureReason: order.failureReason,
    riderName: order.rider.name,
    vendorName: env.demoVendorName,
  });
});

const NOT_MARKABLE_MESSAGES: Partial<Record<OrderStatus, string>> = {
  confirmed: "This delivery hasn't been dispatched yet.",
  delivered: "This delivery is already marked as delivered.",
  failed: "This delivery is already marked as failed.",
};

// POST /rider/:token/outcome — { outcome: "delivered" } or
// { outcome: "failed", reason: <FailureReason> }. Once only.
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
    where: { id: order.id, status: "dispatched" },
    data: {
      status,
      completedAt: new Date(),
      failureReason: failed ? (reason as FailureReason) : null,
    },
  });

  if (count === 0) {
    const current = await prisma.order.findUnique({ where: { id: order.id } });
    const currentStatus = current?.status ?? order.status;
    res.status(409).json({
      error:
        NOT_MARKABLE_MESSAGES[currentStatus] ??
        "This delivery can't be marked right now.",
      status: currentStatus,
    });
    return;
  }

  res.json({ status, failureReason: failed ? reason : null });
});

export default router;
