// Route segment config for the home route (`/`).
// Kept in a plain module (no JSX, no Harper imports) so unit tests can import
// the real production values; app/page.js re-exports them for Next.js.

// ISR: cache the server-rendered page (via the Harper cache handler) and
// regenerate at most every 60 seconds.
export const revalidate = 60;
