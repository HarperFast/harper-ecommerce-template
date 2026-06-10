// Route segment config for the products listing route (`/products`).
// Kept in a plain module (no JSX, no Harper imports) so unit tests can import
// the real production values; app/products/page.js re-exports them for Next.js.

// ISR: server-render the listing (product grid in the initial HTML), cache it
// via the Harper cache handler, and regenerate at most every 60 seconds.
export const revalidate = 60;
