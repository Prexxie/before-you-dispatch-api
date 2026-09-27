# API contract

The contract between `before-you-dispatch-api` and `before-you-dispatch-web`. Update this file in the same PR as any change to an endpoint.

Errors always come back as JSON with an `error` string, and `fields` when specific inputs are at fault.

## Order statuses

`pending_confirmation` → `confirmed` or `not_ready` → (later features) `dispatched` → `delivered` or `failed`

---

## `GET /health`

`200` → `{ "status": "ok" }`

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

All four fields are required, non-empty strings (surrounding whitespace is trimmed).

**Responses**

- `201`: the created order:
  ```json
  {
    "id": "cmujoqqwi0000mwsb7ut44ylh",
    "customerName": "Amaka Obi",
    "customerPhone": "+2348031234567",
    "itemDescription": "2 trays of jollof rice",
    "riderId": "seed-rider-1",
    "status": "pending_confirmation",
    "createdAt": "2026-09-27T10:38:16.242Z",
    "customerToken": "bb32509d-7776-4518-94f6-6e8538888139"
  }
  ```
  `customerToken` goes in the customer's link. Never put `id` in a public link.
- `400` `{ "error": "Missing or empty required fields", "fields": [...] }`
- `400` `{ "error": "riderId does not match any rider", "fields": ["riderId"] }`
- `400` `{ "error": "Request body is not valid JSON" }`

---

## `GET /orders/:customerToken/confirm`

Public, with no auth. Gives the customer page what it needs to ask "you have a delivery today, are you ready?". It leaves out customer name, phone, and internal ids.

- `200` → `{ "itemDescription": "...", "status": "pending_confirmation", "awaitingResponse": true }`
  When `awaitingResponse` is `false`, the customer has already answered; show the status instead of the buttons.
- `404` → `{ "error": "Order not found" }`

## `POST /orders/:customerToken/confirm`

Public, with no auth. The customer's one-time answer.

**Body:** `{ "ready": true }` or `{ "ready": false }` (it must be a boolean)

- `200` → `{ "status": "confirmed", "message": "Thanks! You're confirmed for today's delivery." }`
- `200` → `{ "status": "not_ready", "message": "Got it. We won't send a rider out today." }`
- `400` → `{ "error": "Body must be { ready: true } or { ready: false }", "fields": ["ready"] }`
- `404` → `{ "error": "Order not found" }`
- `409`: already answered, and the answer isn't overwritten:
  `{ "error": "You've already confirmed you're ready for this delivery.", "status": "confirmed" }`
