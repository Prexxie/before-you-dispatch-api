import { Order, OrderAttempt, Rider, Vendor } from "../generated/prisma/client";
import { vendorDetails } from "../config/env";

export function orderLocation(order: Order) {
  if (order.lat == null || order.lng == null || order.landmarkNote == null) {
    return null;
  }
  return {
    lat: order.lat,
    lng: order.lng,
    landmarkNote: order.landmarkNote,
    address: order.locationAddress,
  };
}

// What the vendor sees for one order. The rider's token only appears once
// the customer's pin is saved: no rider link before the customer is ready
// and has said where to find them.
type OrderForVendor = Order & {
  rider: Rider;
  vendor: Vendor;
  // Earlier rounds (failed deliveries and customer declines), oldest first.
  // Only loaded for the single-order view.
  attempts?: (OrderAttempt & { rider: Rider })[];
};

export function vendorOrderView(order: OrderForVendor) {
  const location = orderLocation(order);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    itemDescription: order.itemDescription,
    status: order.status,
    // 1 for the first delivery attempt; goes up each time a failed order is
    // redelivered.
    attempt: order.attempt,
    // When the vendor retriggered a declined order (null if never).
    retriggeredAt: order.retriggeredAt,
    attempts: (order.attempts ?? []).map((a) => ({
      // "failed" (the rider couldn't deliver) or "declined" (the customer
      // said "Not now"; `failedAt` is when, and there's no reason or pin).
      outcome: a.outcome,
      attemptNumber: a.attemptNumber,
      riderName: a.rider.name,
      failureReason: a.failureReason,
      failureNote: a.failureNote,
      dispatchedAt: a.dispatchedAt,
      pickedUpAt: a.pickedUpAt,
      arrivedAt: a.arrivedAt,
      failedAt: a.failedAt,
      location:
        a.lat != null && a.lng != null && a.landmarkNote != null
          ? { lat: a.lat, lng: a.lng, landmarkNote: a.landmarkNote, address: a.address }
          : null,
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    customerToken: order.customerToken,
    rider: {
      id: order.rider.id,
      name: order.rider.name,
      phone: order.rider.phone,
      vehicle: order.rider.vehicle,
    },
    location,
    riderToken: location ? order.riderToken : null,
    confirmedAt: order.confirmedAt,
    notReadyAt: order.notReadyAt,
    locationSavedAt: order.locationSavedAt,
    dispatchedAt: order.dispatchedAt,
    // Set when the rider tapped "Accept Delivery".
    acceptedAt: order.acceptedAt,
    pickedUpAt: order.pickedUpAt,
    arrivedAt: order.arrivedAt,
    receivedAt: order.receivedAt,
    completedAt: order.completedAt,
    failureReason: order.failureReason,
    failureNote: order.failureNote,
    deliveryConfirmedBy: order.deliveryConfirmedBy,
    // Set when the rider tapped "Decline Delivery" and the vendor hasn't
    // picked another rider (or resent the link) yet.
    riderDeclinedAt: order.riderDeclinedAt,
    declinedRiderName: order.declinedRiderName,
    vendor: vendorDetails(order.vendor),
  };
}
