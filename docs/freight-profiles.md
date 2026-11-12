# Public freight profiles (plan)

Status: planned, not started. Written down 2026-11-12 from the owner's request.

## What

A public page for a jump freight service. Its owner is a pilot, a corporation or an alliance.
Anyone (no sign-in) asks for a quote there:

- picks **where from**, **where to** and **how many m³** (and the collateral);
- gets the price on that profile's own terms, with the route shown as the client's freight link
  is (systems and distances, no fuel, fatigue or skills).

## The trip that is priced

A profile has a **home system** (its base, where transports leave from). The quote covers the whole
flight the carrier makes, not just the client's leg:

1. from the base to the pickup system (empty),
2. the client's leg, pickup to delivery (loaded),
3. from the delivery system back to the base (empty).

Each part is planned with the profile's ship and skill levels; the fuel of all three counts in the
price. The client sees only the price and their own leg.

## The profile's settings

- Owner: an account (pilot), or a corporation or alliance (set up by its directors / executors;
  who may edit it follows the in-game roles we can read through ESI).
- Ship (a jump freighter by default), skill levels, home system, fuel hub.
- Freight terms as the planner's freight quote has them: fuel markup, collateral fee, base reward,
  per m³, per jump, minimum, and the **low-sec surcharge**.
- Limits: largest cargo (m³) and collateral it takes; regions or systems it does not serve.
- A public link (`/f/<slug>`), off until the owner publishes it.

## Notes

- Built on the planner's freight quote (`apps/web/src/jump/freight.ts`) and the client freight
  link (`JumpShareFreight`), which already leave fuel out of what a client sees.
- Quotes are planned again on every request (fuel prices and the k-space data change), rate-limited
  per address like other public pages.
