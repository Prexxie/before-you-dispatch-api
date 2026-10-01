# API contract

The contract between `before-you-dispatch-api` and `before-you-dispatch-web`. Update this file in the same PR as any change to an endpoint.

Errors always come back as JSON with an `error` string, and `fields` when specific inputs are at fault.

## Order statuses

```
pending_confirmation ─┬─> confirmed ──(pin saved, vendor sends rider link)──> dispatched ──(rider picks up)──> dispatched + pickedUpAt ──(rider: "I've arrived")──> + arrivedAt ─┬─(customer: "I've received it")─> + receivedAt ──(rider completes)──> delivered
                      └─> not_ready (final; vendor "retrigger" -> pending_confirmation, new link)                                                                                        ├─(vendor override)──────────────────────────────────────────> delivered
                                                                                                                                                                                 └─(rider, before receipt)─> failed (+ failureReason)
```

- `not_ready` means the customer chose "Not now" **and** confirmed the warning: it's final for that link (the link is closed). The vendor can `POST /orders/:id/retrigger` to issue a new link and start fresh.
- A `failed` order can be redelivered by the vendor (`POST /orders/:id/redeliver`): the failed attempt is kept in the order's history (`attempts`), `attempt` goes up, and the order returns to `pending_confirmation` with new customer and rider links, so the customer confirms again. Both actions are vendor-triggered; there is no customer-facing reschedule link (deferred in CLAUDE.md).
- An order is only dispatched once it's `confirmed` **and** has a saved pin (the confirm-before-dispatch rule).
- Every transition has its own timestamp, so the full timeline can be shown without guessing from `status` alone: `confirmedAt`, `notReadyAt`, `locationSavedAt`, `dispatchedAt`, `pickedUpAt`, `arrivedAt`, `receivedAt`, `completedAt`.
- Picking up is a rider-only step, separate from dispatch: the rider's pin and landmark note (`GET /rider/:riderToken`) are withheld until `pickedUpAt` is set, not just hidden in the UI. It's informational for sequencing, not a hard gate on the outcome endpoint — a rider who forgets to tap "picked up" can still mark the delivery completed or failed.
- "I've arrived" (`arrivedAt`) is the same kind of step: purely informational, requires pickup first, doesn't gate or unlock anything else, and tapping it again is harmless.
- Completing a delivery needs the customer's receipt first (`receivedAt`). If the customer can't confirm, the vendor can mark it delivered (`deliveryConfirmedBy: "vendor"`). The rider can only mark it failed *before* the customer confirms receipt.
- "Today" is the calendar day in Nigeria (WAT, UTC+1).
- Failure reasons (preset only): `customer_not_ready`, `address_not_found`, `customer_unreachable`, `other`.
- `deliveryConfirmedBy`: `customer` (they tapped "I've received my delivery") or `vendor` (override); `null` until then.
- `vendor` (in several responses): `{ "name": "Precious Food Business", "address": "12 Allen Avenue, Ikeja", "phone": "0803 214 7765", "logoUrl": null }`. `name` and `address` are always set (both required at sign up); `phone` and `logoUrl` are `null` if never added. Comes from the logged-in vendor's account.

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
  "logoDataUrl": "data:image/png;base64,...",
  "ownerName": "Precious Adebayo",
  "category": "food_restaurant",
  "email": "owner@precious-food.example",
  "password": "at least 8 characters"
}
```

`businessAddress` is required — it's the rider's pickup point, not just context. `businessPhone` and `logoDataUrl` are optional (`null` if left out). `businessName`, `businessAddress`, `ownerName`, a valid `category`, a valid `email` and a `password` of at least 8 characters are required. `logoDataUrl`, if sent, must be a `data:image/(png|jpeg|webp|gif);base64,...` string under 500 KB decoded, or it's a `400`. `ownerName` and `category` are account context only — never shown to customers or riders. `category` is one of: `retail_ecommerce` ("Retail / e-commerce"), `food_restaurant` ("Food or restaurant"), `pharmacy` ("Pharmacy"), `delivery_logistics` ("Delivery / logistics / dispatch company"), `other`.

- `201`: the created vendor (never includes `passwordHash`): `{ "id", "businessName", "businessAddress", "businessPhone", "logoUrl", "ownerName", "category", "themeColor", "email", "hasPassword" }`. Sets the session cookie. `themeColor` always starts `"green"` (see `PATCH /auth/me` below).
- `400` `{ "error": "...", "fields": [...] }`
- `409` `{ "error": "An account with this email already exists", "fields": ["email"] }`

### `POST /auth/login`

**Body** `{ "email": "...", "password": "..." }`

- `200`: the vendor (same shape as signup). Sets the session cookie.
- `401` `{ "error": "Incorrect email or password" }`

### `POST /auth/forgot-password`

**Body** `{ "email": "..." }`

- `200` `{ "message": "If that email has an account, a reset link is on its way." }` — the same response whether or not the email has an account, so this can't be used to find out who does. If it does, a link to `<WEB_URL>/vendor/reset-password?token=...` is emailed. It works once and expires after an hour; asking again voids the earlier link. Only a SHA-256 hash of the token is stored.
- `400` `{ "error": "Enter a valid email address", "fields": ["email"] }`

Email goes out over Brevo's HTTPS API (`EMAIL_API_KEY`, and `EMAIL_FROM`, a sender verified in Brevo). With no `EMAIL_API_KEY`, the link is printed to the API console instead, so it can be tried locally with nothing set up. A failed send is logged, never returned, for the same reason the response is generic.

### `POST /auth/reset-password`

**Body** `{ "token": "<from the emailed link>", "newPassword": "at least 8 characters" }`

- `200` `{ "message": "Password updated" }`
- `400` `{ "error": "newPassword must be at least 8 characters", "fields": ["newPassword"] }`
- `400` `{ "error": "This reset link is invalid or has expired. Request a new one.", "fields": ["token"] }` — unknown, already used, or expired.

### `POST /auth/google`

Sign in with Google. **Body** `{ "credential": "<ID token from the Sign in with Google button>" }`. The API verifies it with Google (signature, that it was issued for *our* client ID, expiry, and that Google vouches for the email) — never trusting what the browser says about who signed in.

- `200` `{ "status": "signed_in", "vendor": {...} }` — sets the session cookie. Used when an account is already linked to this Google user, or one exists with the same email (Google-verified, so it is linked on the spot).
- `200` `{ "status": "needs_setup", "ticket": "...", "email": "...", "name": "..." }` — no account yet. No cookie is set; business details are still needed. The `ticket` is a signed token valid for 15 minutes that carries the verified identity into the next call.
- `401` `{ "error": "Couldn't verify your Google sign-in. Try again." }` — also when `GOOGLE_CLIENT_ID` isn't configured.

### `POST /auth/google/signup`

Creates the account for a `needs_setup` Google user. **Body** `{ "ticket", "businessName", "businessAddress", "ownerName", "category", "businessPhone"?, "logoDataUrl"? }`, validated like `POST /auth/signup`. The email comes from the ticket, never the body. The account has no password (`hasPassword: false`) until the vendor sets one, via forgot-password or Settings.

- `201` the vendor; sets the session cookie.
- `400` `{ "error": "...", "fields": [...] }` — including `"ticket"` for an expired or forged one.
- `409` an account with this email or Google user already exists.

### `POST /auth/logout`

Clears the session cookie. `204`, no body.

### `GET /auth/me`

The logged-in vendor, or `401` if there isn't one. Used to restore a session on page load.

`200`: the vendor (same shape as signup).

### `PATCH /auth/me`

The "Edit Profile" form, plus the "Workspace theme" swatch picker (design: "Vendor: Settings") — the picker just sends `{ "themeColor": "..." }` on its own on each click. Body: any of `businessName`, `businessAddress`, `businessPhone`, `logoDataUrl`, `ownerName`, `category`, `themeColor` — only the fields sent are changed. `email` and `password` aren't editable here (password has its own route below; email isn't editable in this build).

```json
{ "businessName": "Precious Food Business", "businessAddress": "12 Allen Avenue, Ikeja" }
```

`businessPhone` and `logoDataUrl` clear to `null` when sent as an empty string. `businessName`, `businessAddress` and `ownerName` can't be cleared (`400` if sent empty); `category` and `themeColor` must be one of the valid values if sent; `logoDataUrl` follows the same rules as at sign up.

`themeColor` is one of `green` (the default — literally "no override": the app's own green/crimson look, unchanged), `crimson`, `navy`, `amber`, `purple`. A non-`green` value re-tints the vendor's own dashboard chrome (primary buttons, the sidebar, borders, highlighted stats and badges) to that one color — purely cosmetic, never sent to or seen by customers or riders, and the "WakaRoute" brand mark itself never changes.

- `200`: the updated vendor (same shape as signup).
- `400` `{ "error": "...", "fields": [...] }` — including `{ "error": "Nothing to update", "fields": [] }` for an empty body.

### `POST /auth/change-password`

**Body** `{ "currentPassword": "...", "newPassword": "at least 8 characters" }`

- `200` `{ "message": "Password changed" }`. An account made with Google (`hasPassword: false`) has no current password to check, so it can set one without `currentPassword`.
- `400` `{ "error": "newPassword must be at least 8 characters", "fields": ["newPassword"] }`
- `401` `{ "error": "Current password is incorrect", "fields": ["currentPassword"] }`

---

## `GET /riders`

The logged-in vendor's riders, sorted by name.

**Query parameters:** `active=true` narrows to riders who can still be assigned (what the create-order dropdown calls). With no filter, every rider is returned, including deactivated ones (the riders management page, which shows both).

`200` → `[{ "id": "seed-rider-2", "name": "Chidi Okafor", "phone": "+2348120045521", "vehicle": "car", "active": true }, ...]`

`vehicle` is `"bike"`, `"car"`, `"van"` or `null`.

A newly signed-up vendor has none to assign until they add one; use the seeded demo vendor (`demo@beforeyoudispatch.test` / `ChangeMe123!`, from `yarn db:seed`) for a head start locally.

---

## `POST /riders`

Add a rider — the vendor's own staff, or a third-party dispatch rider they use often.

**Body**

```json
{ "name": "Lawan Musa", "phone": "0803 555 1234", "vehicle": "bike" }
```

All three are required. `vehicle` is one of `"bike"`, `"car"`, `"van"`.

- `201`: the created rider: `{ "id", "name", "phone", "vehicle", "active": true, "vendorId" }`.
- `400` `{ "error": "...", "fields": [...] }`

---

## `POST /riders/:id/deactivate`

Drops the rider from the "Assign a rider" list (`GET /riders?active=true` and `POST /orders`'s `riderId` check) without touching their order history — never a delete, which would orphan past orders. Sending again is fine.

- `200`: the updated rider (`active: false`).
- `404` `{ "error": "Rider not found" }` — including a rider that belongs to another vendor.

## `POST /riders/:id/activate`

The reverse: the rider can be assigned again. Sending again is fine.

- `200`: the updated rider (`active: true`).
- `404` `{ "error": "Rider not found" }`

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
      "arrivedAt": null,
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
  "location": { "lat": 6.6018, "lng": 3.3515, "landmarkNote": "Blue gate, opposite the pharmacy", "address": "5, Temidire Street, Mafoluku, Oshodi, Lagos" },
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
    "previousLocation": { "lat": 6.6021, "lng": 3.3519, "landmarkNote": "Blue gate, opposite the pharmacy", "address": "5, Temidire Street, Mafoluku, Oshodi, Lagos" }
  }
  ```
  - `vendorName`: the business the delivery is from (the logged-in vendor's `businessName` — always set, since it's required at sign up).
  - `awaitingResponse`: when `false`, the customer has already answered; show the status instead of the buttons.
  - `location`: the pin saved for *this* order, or `null` if none yet.
  - `previousLocation`: the pin this customer (matched by phone number) saved on an earlier order, to prefill the map. Only sent while the order is `confirmed` and has no `location` yet; otherwise `null`.
  - `redelivery`: `null` for a first delivery. After the vendor redelivers a failed order it is `{ "attempt": 2, "failureReason": "address_not_found" | "customer_not_ready" | "customer_unreachable" | "other" | null }` (the reason the previous attempt failed), so the page can say "let's try again" and ask the customer to confirm their location.
  - When `status` is `not_ready` the customer declined and the link is closed: show "This link is no longer active". (`canChangeToReady` was removed 1 Oct.)
- `404` → `{ "error": "Order not found" }`

## `POST /orders/:customerToken/confirm`

Public, with no auth. The customer's answer. It's final: `{ "ready": false }` closes the link for good (the page shows a warning first, so this is deliberate), and `{ "ready": true }` afterwards is refused. Once the customer is `confirmed`, `{ "ready": false }` is still accepted until the rider is sent (they went back a step and changed their mind); after that it's refused. To start again the vendor retriggers the order, which issues a new link.

**Body:** `{ "ready": true }` or `{ "ready": false }` (it must be a boolean)

- `200` → `{ "status": "confirmed", "message": "Thanks! You're confirmed for today's delivery." }`
- `200` → `{ "status": "not_ready", "message": "Got it. We won't send a rider out today." }`
- `400` → `{ "error": "Body must be { ready: true } or { ready: false }", "fields": ["ready"] }`
- `404` → `{ "error": "Order not found" }`
- `409`: already answered, and the answer isn't overwritten:
  `{ "error": "You've already confirmed you're ready for this delivery.", "status": "confirmed" }`
  A declined order gets `"This link is no longer active. If you change your mind, contact the business and they can send you a new one."`

---

## `POST /orders/:customerToken/location`

Public, with no auth. The customer's pin and landmark note (MVP feature 3), plus an optional `address` (text, max 200 characters; blank or omitted is stored as `null`) that the rider reads next to the pin. Can be sent again to correct the pin while the order is `confirmed`; it locks once the order is dispatched. Each save is also remembered for the customer's next order (see `previousLocation` above).

**Body**

```json
{ "lat": 6.6018, "lng": 3.3515, "landmarkNote": "Blue gate, opposite the pharmacy", "address": "5, Temidire Street, Mafoluku, Oshodi, Lagos" }
```

`lat` is a number from -90 to 90, `lng` a number from -180 to 180, `landmarkNote` a string of 1 to 200 characters (surrounding whitespace is trimmed).

- `200` → `{ "location": { "lat": 6.6018, "lng": 3.3515, "landmarkNote": "Blue gate, opposite the pharmacy", "address": "5, Temidire Street, Mafoluku, Oshodi, Lagos" }, "savedAt": "2026-09-28T07:58:35.415Z" }`
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
    "arrivedAt": null,
    "receivedAt": null,
    "deliveryConfirmedBy": null
  }
  ```
  After pickup, `location` is filled in and `pickedUpAt` is set.
- `404` → `{ "error": "Delivery not found" }`

## `POST /rider/:riderToken/pickup`

Public, with no auth. The rider confirms they've collected the order from the vendor. Unlocks `location` on `GET /rider/:riderToken`. No body. Tapping again is harmless.

- `200` → `{ "pickedUpAt": "2026-09-29T13:15:00.000Z", "location": { "lat": 6.6018, "lng": 3.3515, "landmarkNote": "...", "address": "..." } }`
- `404` → `{ "error": "Delivery not found" }`
- `409` → `{ "error": "...", "status": "<current status>" }`:
  - `confirmed` → `"This delivery hasn't been dispatched yet."`
  - `delivered` / `failed` → `"This delivery is already finished."`

## `POST /rider/:riderToken/arrived`

Public, with no auth. The rider confirms they've reached the customer's location, once they've confirmed pickup. Purely a status update — doesn't unlock or gate anything else (completing the delivery still needs the customer's receipt). No body. Tapping again is harmless.

- `200` → `{ "arrivedAt": "2026-09-29T13:22:00.000Z" }`
- `404` → `{ "error": "Delivery not found" }`
- `409` → `{ "error": "...", "status": "<current status>" }`:
  - `dispatched`, before pickup → `"Confirm pickup before marking that you've arrived."`
  - `confirmed` → `"This delivery hasn't been dispatched yet."`
  - `delivered` / `failed` → `"This delivery is already finished."`

## `POST /rider/:riderToken/outcome`

Public, with no auth. The rider marks the delivery, once, while it's `dispatched`.

**Body:** `{ "outcome": "delivered" }` or `{ "outcome": "failed", "reason": "address_not_found" }` (reasons listed under Order statuses). When the reason is `other`, add `"note"`: the rider's own words, 1 to 200 characters, **required** (e.g. `{ "outcome": "failed", "reason": "other", "note": "Motorbike broke down on Ikorodu Road" }`). `note` is ignored for the preset reasons. (The free-text note was on CLAUDE.md's deferred list; added 1 Oct 2026 at the user's request, and only for "other".)

- `200` → `{ "status": "delivered", "failureReason": null, "failureNote": null }` or `{ "status": "failed", "failureReason": "address_not_found", "failureNote": null }` (`failureNote` is set only for `other`)
- `400` → `{ "error": "...", "fields": ["outcome"] }` (or `["reason"]` for a failed outcome without a valid reason, or `["note"]` for `other` without a note or with one over 200 characters)
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

## Rider arrival (added 28 Sep 2026)

New endpoint: `POST /rider/:riderToken/arrived` (above). New field `arrivedAt`, alongside `pickedUpAt`, in every response that already carried it:
- `GET /orders/:customerToken/confirm`, `GET /rider/:riderToken`, `GET /orders/:id`, and each row of `GET /orders`.

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

## `POST /orders/:id/retrigger`

Vendor only. For an order the customer declined (`not_ready`): issues a **new** `customerToken` (the old link stays closed) and puts the order back to `pending_confirmation`, clearing `notReadyAt`. The vendor then sends the new link. The vendor is deciding the delivery is going out today.

**Body (optional):** `{ "riderId": "<id>" }` to change the rider; omit to keep the same one. Must be one of the vendor's active riders.

- `200` → the order, as in `GET /orders/:id` (read `customerToken` for the new link)
- `400` → `{ "error": "riderId does not match any rider", "fields": ["riderId"] }`
- `404` → `{ "error": "Order not found" }`
- `409` → `{ "error": "Only an order the customer declined can be retriggered.", "status": "<current status>" }`

## `POST /orders/:id/redeliver`

Vendor only. For an order the rider marked `failed`. Saves that attempt into the order's history, then resets the order for another attempt: `status` is `pending_confirmation`, `attempt` goes up by one, `customerToken` and `riderToken` are new (old links stop working), every step's timestamp and `failureReason` are cleared, and the order's pin is cleared so the customer re-confirms it (their remembered pin and address still preload on their page, "Same spot as last time?").

**Body (optional):** `{ "riderId": "<id>" }`, as for retrigger.

- `200` → the order, as in `GET /orders/:id`
- `400`, `404` as above
- `409` → `{ "error": "Only an order the rider marked as failed can be redelivered.", "status": "<current status>" }`

`GET /orders/:id` now also returns `retriggeredAt` (when the vendor retriggered a declined order, else `null`; the page uses it to word the follow-up message) and `attempt` (1 for the first try) and `attempts`: earlier failed attempts, oldest first, each `{ attemptNumber, riderName, failureReason, dispatchedAt, pickedUpAt, arrivedAt, failedAt, location: { lat, lng, landmarkNote, address } | null }`.

## `POST /rider/:riderToken/undo-arrived` and `POST /rider/:riderToken/undo-pickup`

Public, with no auth. For a rider who tapped "I've arrived" or "I've picked up" by mistake. No body.

- `undo-arrived`: clears `arrivedAt`. Refused once the customer has confirmed receipt or the delivery is finished. `200` → `{ "arrivedAt": null }`.
- `undo-pickup`: clears `pickedUpAt`, so the customer's pin is withheld again (`location` is `null` on `GET /rider/:riderToken`). Refused while `arrivedAt` is set (undo the arrival first), after receipt, or when finished. `200` → `{ "pickedUpAt": null }`.
- Both are harmless if the step isn't set. `404` → `{ "error": "Delivery not found" }`. `409` → `{ "error": "...", "status": "<current status>" }`.

`failureNote` (the rider's text for reason `other`, else `null`) is returned wherever `failureReason` is: `GET /rider/:riderToken`, `GET /orders/:id` and, per attempt, in `attempts`. It is cleared when a failed order is redelivered (the old note stays on that attempt in `attempts`).

