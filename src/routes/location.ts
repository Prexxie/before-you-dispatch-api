import { Router } from "express";
import { prisma } from "../lib/prisma";
import { findOrderByCustomerToken } from "../lib/customerToken";
import { normalizePhone } from "../lib/phone";
import { OrderStatus } from "../generated/prisma/client";

// Location profile (MVP feature 3). Public, no auth: like the confirm routes,
// the unguessable customerToken is the only credential.
const router = Router();

export const LANDMARK_NOTE_MAX_LENGTH = 200;

const NOT_EDITABLE_MESSAGES: Partial<Record<OrderStatus, string>> = {
  pending_confirmation: "Confirm you're ready before sharing your location.",
  not_ready: "You told us you're not ready for this delivery.",
};

const ALREADY_DISPATCHED_MESSAGE =
  "The rider already has your location for this delivery, so it can't be changed.";

type LocationInput = { lat: number; lng: number; landmarkNote: string };

function parseLocation(
  body: unknown,
): { location: LocationInput } | { fields: string[] } {
  const { lat, lng, landmarkNote } = (body ?? {}) as Record<string, unknown>;
  const fields: string[] = [];

  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    fields.push("lat");
  }
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    fields.push("lng");
  }
  const note = typeof landmarkNote === "string" ? landmarkNote.trim() : "";
  if (note === "" || note.length > LANDMARK_NOTE_MAX_LENGTH) {
    fields.push("landmarkNote");
  }

  if (fields.length > 0) return { fields };
  return { location: { lat: lat as number, lng: lng as number, landmarkNote: note } };
}

// POST /orders/:token/location — body { lat, lng, landmarkNote }.
// Allowed while the order is confirmed, so the customer can correct the pin
// until the rider is sent. Also remembered for the customer's next order.
router.post("/:token/location", async (req, res) => {
  const parsed = parseLocation(req.body);
  if ("fields" in parsed) {
    res.status(400).json({
      error: `Send lat (-90 to 90), lng (-180 to 180) and a landmarkNote of 1 to ${LANDMARK_NOTE_MAX_LENGTH} characters`,
      fields: parsed.fields,
    });
    return;
  }
  const { location } = parsed;

  const order = await findOrderByCustomerToken(req.params.token);
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const savedAt = new Date();
  // Conditional update inside the transaction so a status change racing this
  // request (e.g. the vendor dispatching) can't be overwritten.
  const saved = await prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({
      where: { id: order.id, status: "confirmed" },
      data: { ...location, locationSavedAt: savedAt },
    });
    if (count === 0) return false;
    const phoneKey = normalizePhone(order.customerPhone);
    await tx.savedLocation.upsert({
      where: { phoneKey },
      create: { phoneKey, ...location },
      update: location,
    });
    return true;
  });

  if (!saved) {
    const current = await findOrderByCustomerToken(req.params.token);
    const status = current?.status ?? order.status;
    res.status(409).json({
      error: NOT_EDITABLE_MESSAGES[status] ?? ALREADY_DISPATCHED_MESSAGE,
      status,
    });
    return;
  }

  res.json({ location, savedAt: savedAt.toISOString() });
});

export default router;
