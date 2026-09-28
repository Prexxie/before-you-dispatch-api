import { Order, Rider, Vendor } from "../generated/prisma/client";
import { vendorDetails } from "../config/env";

export function orderLocation(order: Order) {
  if (order.lat == null || order.lng == null || order.landmarkNote == null) {
    return null;
  }
  return { lat: order.lat, lng: order.lng, landmarkNote: order.landmarkNote };
}

// What the vendor sees for one order. The rider's token only appears once
// the customer's pin is saved: no rider link before the customer is ready
// and has said where to find them.
export function vendorOrderView(order: Order & { rider: Rider; vendor: Vendor }) {
  const location = orderLocation(order);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    itemDescription: order.itemDescription,
    status: order.status,
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
    pickedUpAt: order.pickedUpAt,
    arrivedAt: order.arrivedAt,
    receivedAt: order.receivedAt,
    completedAt: order.completedAt,
    failureReason: order.failureReason,
    deliveryConfirmedBy: order.deliveryConfirmedBy,
    vendor: vendorDetails(order.vendor),
  };
}
