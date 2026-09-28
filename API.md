# API contract

The contract between `before-you-dispatch-api` and `before-you-dispatch-web`. Update this file in the same PR as any change to an endpoint.

Errors always come back as JSON with an `error` string, and `fields` when specific inputs are at fault.

## Order statuses

```
pending_confirmation ─┬─> confirmed ──(pin saved, vendor sends rider link)──> dispatched ─┬─> delivered
                      └─> not_ready ──(same day only)──> confirmed                        └─> failed (+ failureReason)
```

- An order is only dispatched once it's `confirmed` **and** has a saved pin (the confirm-before-dispatch rule).
- "Today" is the calendar day in Nigeria (WAT, UTC+1).
- Failure reasons (preset only): `customer_not_ready`, `address_not_found`, `customer_unreachable`, `other`.

---

## `GET /health`

`200` → `{ "status": "ok" }`

---

## `GET /riders`

The riders a vendor can assign when creating an order, sorted by name.

`200` → `[{ "id": "seed-rider-2", "name": "Chidi Okafor", "phone": "+2348120045521", "vehicle": "car" }, ...]`

`vehicle` is `"bike"`, `"car"`, `"van"` or `null`.

---

## `POST /orders`

The vendor creates an order and assigns a rider.

**Body**

```json
{
  "customerName": "Amaka Obi",
  "customerPhone": "+2348031234567",
  "itemDescription": "2 trays of jollof rice",
  "riderId": "seed-rider-1"
}
```

All four fields are required, non-empty strings (surrounding whitespace is trimmed). `customerPhone` must be a phone number: after dropping spaces and symbols it needs 10 to 15 digits (`0803 123 4567`, `+234 803 123 4567` and `2348031234567` all pass).

**Responses**

- `201`: the created order:
  ```json
  {
    "id": "cmujoqqwi0000mwsb7ut44ylh",
    "orderNumber": 36,
    "customerName": "Amaka Obi",
    "customerPhone": "+2348031234567",
    "itemDescription": "2 trays of jollof rice",
    "riderId": "seed-rider-1",
    "status": "pending_confirmation",
    "createdAt": "2026-09-27T10:38:16.242Z",
    "customerToken": "bb32509d-7776-4518-94f6-6e8538888139",
    "lat": null,
    "lng": null,
    "landmarkNote": null,
    "locationSavedAt": null
  }
  ```
  `customerToken` goes in the customer's link (`/confirm/<customerToken>` on the web app). Never put `id` or `orderNumber` in a public link. `orderNumber` is the short number the vendor sees ("Order #36").
- `400` `{ "error": "Missing or empty required fields", "fields": [...] }`
- `400` `{ "error": "customerPhone must be a phone number, e.g. 0803 123 4567", "fields": ["customerPhone"] }`
- `400` `{ "error": "riderId does not match any rider", "fields": ["riderId"] }`
- `400` `{ "error": "Request body is not valid JSON" }`

---

## `GET /orders/:id`

One order as the vendor sees it (vendor side; `id` is the order's `id`, never a public token).

`200`:
```json
{
  "id": "cmujoqqwi0000mwsb7ut44ylh",
  "orderNumber": 36,
  "customerName": "Amaka Obi",
  "customerPhone": "0803 123 4567",
  "itemDescription": "2 trays of jollof rice",
  "status": "confirmed",
  "createdAt": "2026-09-28T10:38:16.242Z",
  "customerToken": "bb32509d-7776-4518-94f6-6e8538888139",
  "rider": { "id": "seed-rider-1", "name": "Tunde Bakare", "phone": "+2348012345678", "vehicle": "bike" },
  "location": { "lat": 6.6018, "lng": 3.3515, "landmarkNote": "Blue gate, opposite the pharmacy" },
  "riderToken": "5f0c3c2e-8f1d-4d7a-9a55-0b3f1f6f2c11",
  "dispatchedAt": null,
  "completedAt": null,
  "failureReason": null
}
```

`riderToken` goes in the rider's link (`/rider/<riderToken>` on the web app). It's `null` until the customer's pin is saved, so there is no rider link before the customer is ready and has said where to find them.

- `404` → `{ "error": "Order not found" }`

## `POST /orders/:id/dispatch`

The vendor sent the rider their link. Moves a `confirmed` order with a saved pin to `dispatched` and sets `dispatchedAt`. No body.

- `200` → the order, as in `GET /orders/:id`. Sending again while already `dispatched` also returns `200`, unchanged.
- `404` → `{ "error": "Order not found" }`
- `409` → `{ "error": "...", "status": "<current status>" }`:
  - `pending_confirmation` → `"The customer hasn't confirmed they're ready yet."`
  - `not_ready` → `"The customer said they're not ready today."`
  - `confirmed` with no pin → `"The customer hasn't shared their location yet."`
  - `delivered` / `failed` → `"This delivery is already finished."`

---

## `GET /orders/:customerToken/confirm`

Public, with no auth. Gives the customer page what it needs to ask "you have a delivery today, are you ready?" and, once they've confirmed, to show or prefill their pin. It sends only the customer's first name (for "Hi Amaka"), never their full name, phone, or internal ids.

- `200`:
  ```json
  {
    "customerFirstName": "Amaka",
    "vendorName": "Precious Food Business",
    "itemDescription": "2 trays of jollof rice",
    "status": "confirmed",
    "awaitingResponse": false,
    "location": null,
    "previousLocation": { "lat": 6.6021, "lng": 3.3519, "landmarkNote": "Blue gate, opposite the pharmacy" }
  }
  ```
  - `vendorName`: the business the delivery is from. Until vendor accounts exist it comes from the API's `DEMO_VENDOR_NAME` setting, and is `null` when that isn't set.
  - `awaitingResponse`: when `false`, the customer has already answered; show the status instead of the buttons.
  - `location`: the pin saved for *this* order, or `null` if none yet.
  - `previousLocation`: the pin this customer (matched by phone number) saved on an earlier order, to prefill the map. Only sent while the order is `confirmed` and has no `location` yet; otherwise `null`.
  - `canChangeToReady`: `true` when the customer said "Not now" today and can still change to ready ("Actually, I'm ready").
- `404` → `{ "error": "Order not found" }`

## `POST /orders/:customerToken/confirm`

Public, with no auth. The customer's answer. It's final, with one exception: a customer who said "Not now" can send `{ "ready": true }` later the **same day** (Nigeria time) to confirm after all. Confirmed never goes back to not ready.

**Body:** `{ "ready": true }` or `{ "ready": false }` (it must be a boolean)

- `200` → `{ "status": "confirmed", "message": "Thanks! You're confirmed for today's delivery." }`
- `200` → `{ "status": "not_ready", "message": "Got it. We won't send a rider out today." }`
- `400` → `{ "error": "Body must be { ready: true } or { ready: false }", "fields": ["ready"] }`
- `404` → `{ "error": "Order not found" }`
- `409`: already answered, and the answer isn't overwritten:
  `{ "error": "You've already confirmed you're ready for this delivery.", "status": "confirmed" }`
  A "Not now" order from an earlier day gets `"This delivery was for an earlier day. Please contact the business to arrange a new one."`

---

## `POST /orders/:customerToken/location`

Public, with no auth. The customer's pin and landmark note (MVP feature 3). Can be sent again to correct the pin while the order is `confirmed`; it locks once the order is dispatched. Each save is also remembered for the customer's next order (see `previousLocation` above).

**Body**

```json
{ "lat": 6.6018, "lng": 3.3515, "landmarkNote": "Blue gate, opposite the pharmacy" }
```

`lat` is a number from -90 to 90, `lng` a number from -180 to 180, `landmarkNote` a string of 1 to 200 characters (surrounding whitespace is trimmed).

- `200` → `{ "location": { "lat": 6.6018, "lng": 3.3515, "landmarkNote": "Blue gate, opposite the pharmacy" }, "savedAt": "2026-09-28T07:58:35.415Z" }`
- `400` → `{ "error": "Send lat (-90 to 90), lng (-180 to 180) and a landmarkNote of 1 to 200 characters", "fields": ["lat"] }`
- `404` → `{ "error": "Order not found" }`
- `409`: the order isn't `confirmed`. The body carries the current `status`:
  - `pending_confirmation` → `"Confirm you're ready before sharing your location."`
  - `not_ready` → `"You told us you're not ready for this delivery."`
  - `dispatched` / `delivered` / `failed` → `"The rider already has your location for this delivery, so it can't be changed."`

---

## `GET /rider/:riderToken`

Public, with no auth. Everything the rider needs in one place (MVP feature 4). Only exists once the customer's pin is saved.

- `200`:
  ```json
  {
    "orderNumber": 36,
    "customerName": "Amaka Obi",
    "customerPhone": "0803 123 4567",
    "itemDescription": "2 trays of jollof rice",
    "location": { "lat": 6.6018, "lng": 3.3515, "landmarkNote": "Blue gate, opposite the pharmacy" },
    "status": "dispatched",
    "failureReason": null,
    "riderName": "Tunde Bakare",
    "vendorName": null
  }
  ```
- `404` → `{ "error": "Delivery not found" }`

## `POST /rider/:riderToken/outcome`

Public, with no auth. The rider marks the delivery, once, while it's `dispatched`.

**Body:** `{ "outcome": "delivered" }` or `{ "outcome": "failed", "reason": "address_not_found" }` (reasons listed under Order statuses).

- `200` → `{ "status": "delivered", "failureReason": null }` or `{ "status": "failed", "failureReason": "address_not_found" }`
- `400` → `{ "error": "...", "fields": ["outcome"] }` (or `["reason"]` for a failed outcome without a valid reason)
- `404` → `{ "error": "Delivery not found" }`
- `409` → `{ "error": "...", "status": "<current status>" }`:
  - `confirmed` → `"This delivery hasn't been dispatched yet."`
  - `delivered` → `"This delivery is already marked as delivered."`
  - `failed` → `"This delivery is already marked as failed."`
