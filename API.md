# API contract

The contract between `before-you-dispatch-api` and `before-you-dispatch-web`. Update this file in the same PR as any change to an endpoint.

Errors always come back as JSON with an `error` string, and `fields` when specific inputs are at fault.

## Order statuses

```
pending_confirmation ─┬─> confirmed ──(pin saved, vendor sends rider link)──> dispatched ──(rider picks up)──> dispatched + pickedUpAt ─┬─(customer: "I've received it")─> + receivedAt ──(rider completes)──> delivered
                      └─> not_ready ──(same day only)──> confirmed                                                                      ├─(vendor override)──────────────────────────────────────────> delivered
                                                                                                                                          └─(rider, before receipt)─> failed (+ failureReason)
```

- An order is only dispatched once it's `confirmed` **and** has a saved pin (the confirm-before-dispatch rule).
- Every transition has its own timestamp, so the full timeline can be shown without guessing from `status` alone: `confirmedAt`, `notReadyAt`, `locationSavedAt`, `dispatchedAt`, `pickedUpAt`, `receivedAt`, `completedAt`.
- Picking up is a rider-only step, separate from dispatch: the rider's pin and landmark note (`GET /rider/:riderToken`) are withheld until `pickedUpAt` is set, not just hidden in the UI. It's informational for sequencing, not a hard gate on the outcome endpoint — a rider who forgets to tap "picked up" can still mark the delivery completed or failed.
- Completing a delivery needs the customer's receipt first (`receivedAt`). If the customer can't confirm, the vendor can mark it delivered (`deliveryConfirmedBy: "vendor"`). The rider can only mark it failed *before* the customer confirms receipt.
- "Today" is the calendar day in Nigeria (WAT, UTC+1).
- Failure reasons (preset only): `customer_not_ready`, `address_not_found`, `customer_unreachable`, `other`.
- `deliveryConfirmedBy`: `customer` (they tapped "I've received my delivery") or `vendor` (override); `null` until then.
- `vendor` (in several responses): `{ "name": "Precious Food Business", "address": "12 Allen Avenue, Ikeja", "phone": "0803 214 7765" }`, or `null` if the vendor hasn't set an address/phone (`name` is always set — it's required at sign up). Comes from the logged-in vendor's account.

---

## `GET /health`

`200` → `{ "status": "ok" }`

---

## Vendor authentication

Every route below this point except `POST /auth/signup` and `POST /auth/login` requires a session: an httpOnly cookie (`bad_session`, a JWT) set by signup or login and sent automatically by the browser on same-origin requests. Missing or invalid session → `401 { "error": "Sign in to continue" }`.

A vendor's own data (orders, riders, saved pins) is scoped to their account — one vendor never sees another's, and a request for another vendor's order by id is a `404`, the same as one that doesn't exist.

The customer (`/orders/:customerToken/...`) and rider (`/rider/:riderToken/...`) routes stay public, exactly as before: the unguessable token in the URL is their credential, not a login.

### `POST /auth/signup`

**Body**

```json
{
  "businessName": "Precious Food Business",
  "businessAddress": "12 Allen Avenue, Ikeja",
  "businessPhone": "0803 214 7765",
  "email": "owner@precious-food.example",
  "password": "at least 8 characters"
}
```

`businessAddress` and `businessPhone` are optional (`null` if left out) — shown to customers and riders as "delivered from". `businessName`, a valid `email` and a `password` of at least 8 characters are required.

- `201`: the created vendor (never includes `passwordHash`): `{ "id", "businessName", "businessAddress", "businessPhone", "email" }`. Sets the session cookie.
- `400` `{ "error": "...", "fields": [...] }`
- `409` `{ "error": "An account with this email already exists", "fields": ["email"] }`

### `POST /auth/login`

**Body** `{ "email": "...", "password": "..." }`

- `200`: the vendor (same shape as signup). Sets the session cookie.
- `401` `{ "error": "Incorrect email or password" }`

### `POST /auth/logout`

Clears the session cookie. `204`, no body.

### `GET /auth/me`

The logged-in vendor, or `401` if there isn't one. Used to restore a session on page load.

`200`: the vendor (same shape as signup).

---

## `GET /riders`

The logged-in vendor's riders, for the create-order rider dropdown, sorted by name.

`200` → `[{ "id": "seed-rider-2", "name": "Chidi Okafor", "phone": "+2348120045521", "vehicle": "car" }, ...]`

`vehicle` is `"bike"`, `"car"`, `"van"` or `null`.

Adding riders isn't built yet (week 2) — a newly signed-up vendor has none to assign until then; use the seeded demo vendor (`demo@beforeyoudispatch.test` / `ChangeMe123!`, from `yarn db:seed`) to test order creation locally.

---

## `POST /orders`

The logged-in vendor creates an order and assigns one of their own riders.

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
- `400` `{ "error": "riderId does not match any rider", "fields": ["riderId"] }` — also returned if `riderId` belongs to a different vendor.
- `400` `{ "error": "Request body is not valid JSON" }`
- `401` `{ "error": "Sign in to continue" }`

---

## `GET /orders`

**Every** order for the vendor dashboard (not just today's — a vendor with a handful of orders this week shouldn't see an empty dashboard because none of them landed today), most recently active first, paginated 20 at a time.

"Recent" means `updatedAt`, not `createdAt`: any status change (confirmed, pin saved, dispatched, picked up, received, completed) bumps an order back to the top, so what the vendor acted on or heard about most recently is always visible without scrolling. `updatedAt` is set automatically by the database on every write.

**Query parameters (both optional):**
- `status`: one of the order statuses (below), returns only that status. Anything else is a `400`.
- `page`: 1-based; anything else falls back to `1`.

`200`:
```json
{
  "vendorName": null,
  "today": { "total": 7, "awaitingConfirmation": 2, "outForDelivery": 1, "delivered": 1 },
  "counts": {
    "total": 42, "awaitingConfirmation": 2, "confirmed": 1, "notReady": 1,
    "outForDelivery": 1, "delivered": 36, "failed": 1
  },
  "page": 1,
  "pageSize": 20,
  "totalPages": 3,
  "orders": [
    {
      "id": "cmujoqqwi0000mwsb7ut44ylh",
      "orderNumber": 36,
      "customerName": "Amaka Obi",
      "itemDescription": "2 trays of jollof rice",
      "riderName": "Tunde Bakare",
      "status": "confirmed",
      "hasLocation": true,
      "pickedUpAt": null,
      "receivedAt": null,
      "failureReason": null,
      "deliveryConfirmedBy": null,
      "createdAt": "2026-09-28T10:38:16.242Z",
      "updatedAt": "2026-09-28T10:41:02.118Z"
    }
  ]
}
```

- `today`: a snapshot of *today's* orders only (Nigeria time), for the four "today" stat tiles. Not affected by `status` or `page`.
- `counts`: all-time totals per status, for the filter chips. Also not affected by `status` or `page` — every chip always shows its true total, including the one currently selected.
- `page` / `orders`: the current page of the (optionally `status`-filtered) full order list.
- `400` → `{ "error": "status must be one of: ...", "fields": ["status"] }`

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
  - `vendorName`: the business the delivery is from (the logged-in vendor's `businessName` — always set, since it's required at sign up).
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

`location` is `null` until the rider has confirmed pickup (`pickedUpAt`) — withheld by the API, not just hidden on the page. Everything else (who, what, the pickup point) is available straight away.

- `200`, before pickup:
  ```json
  {
    "orderNumber": 36,
    "customerName": "Amaka Obi",
    "customerPhone": "0803 123 4567",
    "itemDescription": "2 trays of jollof rice",
    "location": null,
    "status": "dispatched",
    "failureReason": null,
    "riderName": "Tunde Bakare",
    "vendorName": null,
    "vendor": { "name": "Precious Food Business", "address": "12 Allen Avenue, Ikeja", "phone": "0803 214 7765" },
    "pickedUpAt": null,
    "receivedAt": null,
    "deliveryConfirmedBy": null
  }
  ```
  After pickup, `location` is filled in and `pickedUpAt` is set.
- `404` → `{ "error": "Delivery not found" }`

## `POST /rider/:riderToken/pickup`

Public, with no auth. The rider confirms they've collected the order from the vendor. Unlocks `location` on `GET /rider/:riderToken`. No body. Tapping again is harmless.

- `200` → `{ "pickedUpAt": "2026-09-29T13:15:00.000Z", "location": { "lat": 6.6018, "lng": 3.3515, "landmarkNote": "..." } }`
- `404` → `{ "error": "Delivery not found" }`
- `409` → `{ "error": "...", "status": "<current status>" }`:
  - `confirmed` → `"This delivery hasn't been dispatched yet."`
  - `delivered` / `failed` → `"This delivery is already finished."`

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

---

## Receipt confirmation (changed 28 Sep, CLAUDE.md flow step 6)

New fields in existing responses:
- `GET /orders/:customerToken/confirm` adds `vendor`, `rider` (`{ "name", "phone" }` once the order is dispatched, else `null`), `pickedUpAt` and `receivedAt`.
- `GET /rider/:riderToken` adds `vendor` (the pickup point), `pickedUpAt`, `receivedAt` and `deliveryConfirmedBy`.
- `GET /orders/:id` adds `vendor`, `confirmedAt`, `notReadyAt`, `locationSavedAt`, `pickedUpAt`, `receivedAt` and `deliveryConfirmedBy`.
- `GET /orders` adds `vendor`, and each row adds `pickedUpAt`, `receivedAt` and `deliveryConfirmedBy`.

`POST /rider/:riderToken/outcome` now also answers `409` with `"status": "dispatched"`:
- `{ "outcome": "delivered" }` before the customer confirms receipt → `"Waiting for the customer to confirm they've received it."`
- `{ "outcome": "failed", ... }` after the customer confirmed receipt → `"The customer confirmed they received it, so it can't be marked failed."`

## `POST /orders/:customerToken/received`

Public, with no auth. The customer taps "I've received my delivery". No body.

- `200` → `{ "status": "dispatched", "receivedAt": "2026-09-28T14:41:00.000Z" }`. Tapping again, or after the vendor already marked it delivered, also returns `200`.
- `404` → `{ "error": "Order not found" }`
- `409` → `{ "error": "Your delivery hasn't been sent out yet.", "status": "confirmed" }` (or, for a failed order, `"This delivery was marked as not delivered. Please contact the business."`)

## `POST /orders/:id/delivered`

The vendor marks a `dispatched` order delivered when the customer can't confirm it themselves. No body. Sets `completedAt`, and `deliveryConfirmedBy` becomes `customer` if they had already confirmed receipt, otherwise `vendor`.

- `200` → the order, as in `GET /orders/:id`
- `404` → `{ "error": "Order not found" }`
- `409` → `{ "error": "This delivery is already finished." | "Only a dispatched order can be marked delivered.", "status": "<current status>" }`
