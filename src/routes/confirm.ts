import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  UUID_PATTERN,
  findOrderByCustomerToken as findOrderByToken,
} from "../lib/customerToken";
import { normalizePhone } from "../lib/phone";
import { vendorDetails } from "../config/env";
import { orderLocation } from "../lib/orderView";
import { Order, OrderStatus } from "../generated/prisma/client";

// Customer confirmation (MVP feature 2). Public, no auth: the unguessable
// customerToken in the URL is the only credential.
const router = Router();

// "Not now" is final (the customer saw a warning first): the link is closed.
// The vendor can retrigger the delivery, which issues a new link.
const DECLINED_MESSAGE =
  "This link is no longer active. If you change your mind, contact the business and they can send you a new one.";

const ALREADY_ANSWERED_MESSAGES: Partial<Record<OrderStatus, string>> = {
  confirmed: "You've already confirmed you're ready for this delivery.",
  not_ready: DECLINED_MESSAGE,
};

const PAST_CONFIRMATION_MESSAGE =
  "This delivery has already moved past confirmation.";

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
    ? {
        lat: saved.lat,
        lng: saved.lng,
        landmarkNote: saved.landmarkNote,
        address: saved.address,
      }
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

  // A redelivery after the rider failed the last attempt: the page words
  // itself differently and asks the customer to check their location.
  const lastAttempt =
    order.attempt > 1
      ? await prisma.orderAttempt.findFirst({
          where: { orderId: order.id, outcome: "failed" },
          orderBy: { attemptNumber: "desc" },
        })
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
    redelivery: lastAttempt
      ? { attempt: order.attempt, failureReason: lastAttempt.failureReason }
      : null,
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
    // "Not now" is also allowed after "I'm ready" until the rider is sent (the
    // customer went back a step and changed their mind); "I'm ready" only
    // answers a pending confirmation.
    where: {
      customerToken: token,
      status: ready
        ? "pending_confirmation"
        : { in: ["pending_confirmation", "confirmed"] },
    },
    data: ready ? { status: newStatus, confirmedAt: now } : { status: newStatus, notReadyAt: now },
  });

  if (count === 0) {
    const order = await findOrderByToken(token);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.status(409).json({
      error:
        ALREADY_ANSWERED_MESSAGES[order.status] ?? PAST_CONFIRMATION_MESSAGE,
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
