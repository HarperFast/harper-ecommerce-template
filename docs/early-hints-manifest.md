# Early Hints manifest (per route)

This manifest describes, per measured route, the resources an upstream Early
Hints (HTTP `103`) emitter should `preconnect`/`preload`. The app itself never
emits `103` and never strips or overwrites `Link` or `Server-Timing` response
headers (the `server-timing` component only ever *appends* its `decision;dur`
segment); the `103` is emitted upstream in follow-origin mode.

Image URLs are stable because `next.config.js` sets `images: { unoptimized: true }`:
the rendered HTML contains the canonical `images.unsplash.com` URLs verbatim —
nothing is rewritten through `/_next/image?...`. All product and hero images
live on a single external host, so one `preconnect` covers every route.

**Preconnect host (all routes):** `https://images.unsplash.com`

Keep the total hint `Link` header value within a 3 KB budget; prefer the
preconnect plus the single LCP preload over exhaustively listing assets.

## /

- preconnect: `https://images.unsplash.com`
- preload (LCP hero image, `as=image`, `fetchpriority=high`):
  `https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&q=80&w=2000`
  (fixed `src` of the `priority` hero `next/image` in `app/page.js`)
- preload: critical CSS and first-load JS chunks — see
  [Critical CSS / first-load JS chunks](#critical-css--first-load-js-chunks)

## /products

- preconnect: `https://images.unsplash.com`
- preload (LCP first product-card image, `as=image`, `fetchpriority=high`):
  `https://images.unsplash.com/photo-1623251606108-512c7c4a3507?auto=format&fit=crop&q=80&w=800`
  (image of the first product in the server-rendered grid: the listing renders
  `listProducts()` results in primary-key order through
  `filterProducts(..., sortBy: 'featured')`, which preserves order, so the
  first card is product id `11` from `productdata.json`. If the seed data or
  ordering changes, refresh this URL from the first `<img fetchpriority="high">`
  in the rendered `/products` HTML.)
- preload: critical CSS and first-load JS chunks — see
  [Critical CSS / first-load JS chunks](#critical-css--first-load-js-chunks)

## /products/[id]

- preconnect: `https://images.unsplash.com`
- preload (LCP main product image, `as=image`, `fetchpriority=high`): the
  product's canonical `image` attribute from the `Product` table
  (`productdata.json` seed). This route is dynamic, so the exact URL varies
  per id; upstream hints must be configured per concrete URL. Representative
  example for `/products/11`:
  `https://images.unsplash.com/photo-1623251606108-512c7c4a3507?auto=format&fit=crop&q=80&w=800`
  To regenerate per-id hints, read the `<img fetchpriority="high">` `src` from
  the rendered document, or the `image` field of `productdata.json` /
  `Product.get(id)` — they are identical because image URLs are un-rewritten.
- preload: critical CSS and first-load JS chunks — see
  [Critical CSS / first-load JS chunks](#critical-css--first-load-js-chunks)

## /products/[id]/personalized

- preconnect: `https://images.unsplash.com`
- preload (LCP main product image, `as=image`, `fetchpriority=high`): identical
  to `/products/[id]` for the same id — the personalized route renders the same
  `ProductPage` component with the same canonical product `image` URL.
  Representative example for `/products/11/personalized`:
  `https://images.unsplash.com/photo-1623251606108-512c7c4a3507?auto=format&fit=crop&q=80&w=800`
- preload: critical CSS and first-load JS chunks — see
  [Critical CSS / first-load JS chunks](#critical-css--first-load-js-chunks)

## Critical CSS / first-load JS chunks

Next.js fingerprints CSS and JS chunk filenames (e.g.
`/_next/static/css/<hash>.css`, `/_next/static/chunks/main-app-<hash>.js`), so
they **change on every build and must not be hard-coded here**. Refresh them
from the built document `<head>` after each deploy:

1. Build and start the app (`npm run build`, then `npm start`).
2. Fetch a route's HTML, e.g. `curl -s http://localhost:9926/ | head -c 4000`.
3. Collect from the `<head>`:
   - critical CSS: `<link rel="stylesheet" href="/_next/static/css/...">`
   - first-load JS: `<script src="/_next/static/chunks/...">` entries (the
     framework/main-app chunks shared by every route)
4. Update the upstream hint configuration with those paths. Keep the combined
   `Link` value within the 3 KB budget — if it would exceed it, drop the JS
   chunk preloads first; the image preload and preconnect matter most for LCP.
