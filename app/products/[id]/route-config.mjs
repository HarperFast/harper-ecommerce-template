// Route segment config for the product detail route (`/products/[id]`).
// Kept in a plain module (no JSX, no Harper imports) so unit tests can import
// the real production values; app/products/[id]/page.js re-exports them.

// On-demand ISR: no build-time prerender of every product (which contended
// for the database lock); each product renders on first request and is cached
// via the Harper cache handler for up to 60 seconds.
export const revalidate = 60;
export const dynamicParams = true;
