import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  UUID_PATTERN,
  findOrderByCustomerToken as findOrderByToken,
} from "../lib/customerToken";
import { normalizePhone } from "../lib/phone";
import { env } from "../config/env";
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

function orderLocation(order: Order) {
  if (order.lat == null || order.lng == null || order.landmarkNote == null) {
    return null;
  }
  return { lat: order.lat, lng: order.lng, landmarkNote: order.landmarkNote };
}

// A pin from the customer's earlier order, offered to prefill the map. Only
// while they still need to share one for this order.
async function previousLocation(order: Order) {
  if (order.status !== "confirmed" || orderLocation(order)) return null;
  const saved = await prisma.savedLocation.findUnique({
    where: { phoneKey: normalizePhone(order.customerPhone) },
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

  res.json({
    customerFirstName: order.customerName.split(/\s+/)[0],
    vendorName: env.demoVendorName,
    itemDescription: order.itemDescription,
    status: order.status,
    awaitingResponse: order.status === "pending_confirmation",
    location: orderLocation(order),
    previousLocation: await previousLocation(order),
  });
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

  // Conditional update so two taps racing each other can't both win.
  const { count } = await prisma.order.updateMany({
    where: { customerToken: token, status: "pending_confirmation" },
    data: { status: newStatus },
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
