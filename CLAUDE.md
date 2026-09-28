# Before You Dispatch — Project Context

A simple way to stop wasted delivery trips: the customer confirms they're ready and shares exactly where to find them, before a rider is ever sent out.

This file is the source of truth for scope. Read it before scaffolding or adding any feature. If a request conflicts with the "explicitly out of scope" section below, flag it instead of building it.

## Problem statement

Deliveries often fail or run late because nobody checks if the customer is ready before a rider is sent out, and riders often struggle to find the address once they're on the way.

Main causes:
- Customer isn't home or isn't ready when the rider arrives
- Rider can't find the address
- No quick way to hand off confirmed details between the vendor, the rider, and the customer

## Who it's for

- **Vendors**: small business owners who use dispatch riders to deliver goods to customers
- **Customers**: the people receiving the delivery
- **Riders**: the ones carrying the delivery from vendor to customer

## MVP features (build these five)

1. **Create order.** Vendor creates a delivery order with the customer's details and assigns a rider.
2. **Customer confirmation.** Customer gets a link and taps "I'm ready" or "Not now," before any rider is sent out.
3. **Location profile.** Once confirmed, the customer sets their exact spot on a map: it opens already centered near their current location using their phone, or they can search their estate or street by name to jump there, then drag to fine-tune the exact spot. They add a short landmark note on top of that ("blue gate, opposite the pharmacy"). If they've ordered from this vendor before, their saved pin loads automatically.
4. **Rider handoff.** Rider gets a link with the confirmed details, the pin, and the landmark note, everything they need in one place, plus the pickup point (the vendor's business name, address, and phone). The customer's and rider's messages and pages always say which business the delivery is from (name, address, phone).
5. **Vendor dashboard.** Vendor sees the live status of every delivery: confirmed, dispatched, delivered, or failed with a reason.

## Critical scope boundaries — read carefully

- **Same-day only.** This is a same-day readiness check ("are you ready today"), not a scheduling tool. The customer never picks a future day or time. That decision (that a delivery is going out today) is made by the vendor when they create the order, before the customer is ever contacted.
- **No live rider/GPS tracking.** The map is only used once, by the customer, to drop a static pin for their own location. There is no background location service, no live tracking of the rider en route.
- **No automation, no analytics dashboard, no reschedule links, no reminders** in this build. See "Explicitly deferred" below.
- **WhatsApp/SMS deliver a link only, nothing else.** They are not a chat interface. No inbound message parsing, no two-way conversation logic. Once the customer or rider taps the link, everything (confirming, dropping the pin, writing the note, marking the outcome) happens on a plain web page.
- **No offline mode for riders.** A rider already needs a data-enabled phone just to receive the delivery link by WhatsApp or SMS, so if they can get the link at all, they can see the pin and the note too.

## Map implementation notes

- Use a free, open map tool (e.g. Leaflet + OpenStreetMap tiles), no paid account, no credit card.
- Center the map near the customer using the phone browser's geolocation permission (built-in, no cost).
- Let the customer search by estate/street name using a free address-search service bundled with the same map stack (e.g. Nominatim).
- Pin should be draggable to fine-tune after auto-center or search.
- None of this needs a paid map subscription. Don't introduce one.

## Messaging notes

- Delivery link goes out by WhatsApp or SMS (Termii, or similar Nigerian SMS gateway).
- Sender-ID approval for SMS can be slow. Start that process early; have a `wa.me` link as a no-approval-needed fallback/complement.
- The message itself is just the link. No bot logic, no reply parsing.

## Explicitly deferred (do NOT build in this MVP)

Left out on purpose for the six-week build. Only touch these if explicitly asked:
- Flexible time windows (pick a day and time range, not just yes/no)
- Automatic reminders to the customer as the delivery time gets close
- Simple analytics (average delivery time, most common failure reasons)
- A reschedule link for the customer if a delivery attempt fails
- A free-text note from the rider on why a delivery failed, beyond preset reasons

## The flow, step by step

1. **Vendor creates the order.** Enters the customer's name, phone number, and what's being delivered, then assigns a rider.
2. **Customer gets a link.** Sent by WhatsApp or SMS. They tap it and see: "I'm ready" or "Not now."
3. **Customer confirms and shares location.** If ready, they drop a pin on a map and add a short landmark note.
4. **Details move to the rider.** The rider gets their own link showing the customer's confirmed availability, the pin, and the landmark note, all in one place.
5. **Rider makes the delivery.** Using the pin and note to find the customer directly, no back-and-forth calls needed.
6. **Customer confirms receipt, rider completes.** When the items are in their hands, the customer taps "I've received my delivery" on their link; only then can the rider mark the delivery completed. If the customer can't confirm (no data, phone off, received by someone else), the vendor can mark it delivered from the order page. Until the customer confirms receipt, the rider can instead mark it failed with a preset reason (customer unavailable, couldn't find address, and so on). (Changed 28 Sep 2026.)
7. **Vendor sees it live.** The dashboard updates automatically: confirmed, dispatched, delivered, or failed with a reason.

## Tech stack

- **Backend (`before-you-dispatch-api`):** Node.js, Express, TypeScript.
- **Frontend (`before-you-dispatch-web`):** TypeScript (framework TBD, e.g. React/Next.js), so both repos share the same language.
- **Deploy targets:** backend on Render or Railway (needs an always-on server, not just serverless functions), frontend on Vercel.

## Repo structure

Two repos, one parent folder, each with its own GitHub remote:
```
before-you-dispatch/
├── before-you-dispatch-web/   — vendor dashboard, customer page, rider page (three views, one app)
├── before-you-dispatch-api/   — orders, statuses, link generation, messaging integration
└── CLAUDE.md                 — this file (copy into both repos too, so it's picked up regardless of which one is opened)
```

Since the frontend and backend are separate repos, they talk over an API contract, not shared code:
- Backend must have CORS enabled for the frontend's origin.
- Frontend needs an env variable pointing at the backend's URL (different value locally vs. once deployed).
- Keep the API contract (endpoints, request/response shapes) documented somewhere both repos can see, so a change on one side doesn't silently break the other.

## Working conventions

- Branch per feature, PR into main.
- Test as you build each feature, not only at the end.
- If time runs short, cut nice-to-haves (WhatsApp fallback polish, extra dashboard detail) before touching the core confirm-before-dispatch rule.