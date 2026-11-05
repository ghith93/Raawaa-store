# Raawaa homepage architecture

This repository uses two deliberately separate public experiences:

- `/` is the luxury brand landing page. It introduces Raawaa, displays the brand identity and product imagery, and directs visitors to the product page.
- `/serum` is the canonical product and checkout experience. It owns size selection, pricing, delivery estimates, cart state, and WhatsApp order handoff.

## Source of truth

- Product sizes, prices, delivery zones, discounts, and offer slots are maintained in `js/config.js`.
- The current product prices in `js/config.js` are explicitly marked as reference values, not final approved prices; confirm them with the owner before enabling production sales.
- Current delivery policy: Sham Cash receives 10% off and free delivery inside Hama; cash on delivery costs $2 inside Hama; other governorates cost $2 for either payment method.
- The product page carries Product JSON-LD. The brand landing page carries social metadata and PWA entry points.

## Test boundaries

- `scripts/browser-test.py` checks the brand landing page at desktop and mobile widths.
- `scripts/serum-browser-test.py` checks product selection, cart, WhatsApp handoff, delivery, and browser behavior on `/serum`.
- `scripts/cart-offers.test.mjs` boots `serum.html`, the page that actually contains the checkout controls.
- Product JSON-LD and cart DOM hooks are audited on `serum.html`, not on the brand landing page.

Generated product imagery remains identified as a design concept in accessible image descriptions; the disclosure is not displayed as a visible caption.
