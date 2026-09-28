import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  UUID_PATTERN,
  findOrderByCustomerToken as findOrderByToken,
} from "../lib/customerToken";
import { normalizePhone } from "../lib/phone";
import { vendorDetails } from "../config/env";
import { isTodayInLagos, startOfLagosDay } from "../lib/lagosDay";
import { orderLocation } from "../lib/orderView";
import { Order, OrderStatus } from "../generated/prisma/client";

// Customer confirmation (MVP feature 2). Public, no auth: the unguessable
// customerToken in the URL is the only credential.
const router = Router();

const ALREADY_ANSWERED_MESSAGES: Partial<Record<OrderStatus, string>> = {
  confirmed: "You've already confirmed you're ready for this delivery.",
  not_ready: "You've already told us you're not ready for this delivery.",
};

const PAST_CONFIRMATION_MESSAGE =
  "This delivery has already moved past confirmation.";

const EARLIER_DAY_MESSAGE =
  "This delivery was for an earlier day. Please contact the business to arrange a new one.";

// A pin from the customer's earlier order, offered to prefill the map. Only
// while they still need to share one for this order.
async function previousLocation(order: Order) {
  if (order.status !== "confirmed" || orderLocation(order)) return null;
  const saved = await prisma.savedLocation.findUnique({
    where: {
      vendorId_phoneKey: {
        vendorId: order.vendorId,
        phoneKey: normalizePhone(order.customerPhone),
      },
    },
  });
  return saved
    ? { lat: saved.lat, lng: saved.lng, landmarkNote: saved.landmarkNote }
    : null;
}

// GET /orders/:token/confirm — what the customer page needs to ask
// "you have a delivery today, are you ready?" and, once confirmed, to show or
// prefill their pin. Only the customer's first name, for the greeting; never
// their full name, phone, or internal ids.
router.get("/:token/confirm", async (req, res) => {
  const order = await findOrderByToken(req.params.token);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  // The rider's name and phone only once they've been sent out.
  const riderSent = ["dispatched", "delivered", "failed"].includes(order.status);
  const rider = riderSent
    ? await prisma.rider.findUnique({ where: { id: order.riderId } })
    : null;

  res.json({
    customerFirstName: order.customerName.split(/\s+/)[0],
    vendorName: order.vendor.businessName,
    vendor: vendorDetails(order.vendor),
    itemDescription: order.itemDescription,
    status: order.status,
    awaitingResponse: order.status === "pending_confirmation",
    location: orderLocation(order),
    previousLocation: await previousLocation(order),
    // "Not now" can be undone the same day ("Actually, I'm ready").
    canChangeToReady:
      order.status === "not_ready" && isTodayInLagos(order.createdAt),
    rider: rider ? { name: rider.name, phone: rider.phone } : null,
    pickedUpAt: order.pickedUpAt,
    arrivedAt: order.arrivedAt,
    receivedAt: order.receivedAt,
  });
});

// POST /orders/:token/received — the customer taps "I've received my
// delivery" once the items are in their hands. Only while dispatched; the
// rider can then mark the delivery completed. Tapping again is harmless.
router.post("/:token/received", async (req, res) => {
  const order = await findOrderByToken(req.params.token);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const receivedAt = new Date();
  const { count } = await prisma.order.updateMany({
    where: { id: order.id, status: "dispatched", receivedAt: null },
    data: { receivedAt, deliveryConfirmedBy: "customer" },
  });

  const current = await findOrderByToken(req.params.token);
  if (!current) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const alreadyReceived =
    current.receivedAt !== null ||
    (current.status === "delivered" && current.deliveryConfirmedBy !== null);
  if (count === 0 && !alreadyReceived) {
    res.status(409).json({
      error:
        current.status === "failed"
          ? "This delivery was marked as not delivered. Please contact the business."
          : "Your delivery hasn't been sent out yet.",
      status: current.status,
    });
    return;
  }
  res.json({ status: current.status, receivedAt: current.receivedAt });
});

// POST /orders/:token/confirm — body { ready: boolean }.
router.post("/:token/confirm", async (req, res) => {
  const { token } = req.params;
  const ready = req.body?.ready;

  if (typeof ready !== "boolean") {
    res.status(400).json({
      error: "Body must be { ready: true } or { ready: false }",
      fields: ["ready"],
    });
    return;
  }

  if (!UUID_PATTERN.test(token)) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const newStatus: OrderStatus = ready ? "confirmed" : "not_ready";
  const now = new Date();

  // Conditional update so two taps racing each other can't both win.
  const { count } = await prisma.order.updateMany({
    where: { customerToken: token, status: "pending_confirmation" },
    data: ready ? { status: newStatus, confirmedAt: now } : { status: newStatus, notReadyAt: now },
  });

  // A customer who said "Not now" can change to ready later the same day
  // (never the other way round). Same conditional-update guard as above.
  if (count === 0 && ready) {
    const undo = await prisma.order.updateMany({
      where: {
        customerToken: token,
        status: "not_ready",
        createdAt: { gte: startOfLagosDay() },
      },
      data: { status: "confirmed", confirmedAt: now },
    });
    if (undo.count === 1) {
      res.json({
        status: "confirmed",
        message: "Thanks! You're confirmed for today's delivery.",
      });
      return;
    }
  }

  if (count === 0) {
    const order = await findOrderByToken(token);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    const tooLate = ready && order.status === "not_ready";
    res.status(409).json({
      error: tooLate
        ? EARLIER_DAY_MESSAGE
        : (ALREADY_ANSWERED_MESSAGES[order.status] ?? PAST_CONFIRMATION_MESSAGE),
      status: order.status,
    });
    return;
  }

  res.json({
    status: newStatus,
    message: ready
      ? "Thanks! You're confirmed for today's delivery."
      : "Got it. We won't send a rider out today.",
  });
});

export default router;
