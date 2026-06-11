/**
 * Server-side accessor for the per-request Server-Timing store (issue #7).
 *
 * Called from the Next.js personalized route to record the fetch-and-customize
 * elapsed time. The server-timing Harper component (extension.mjs) attaches
 * `__serverTimingStore` to the current request before the render starts, then
 * appends `decision;dur=<ms>` to the response headers after next() returns.
 *
 * Harper's transaction() stores the request as the value in its own ALS
 * context. `globalThis.harper.getContext()` retrieves it, giving this accessor
 * a reference to the same store{} object the middleware holds — no separate
 * ALS needed, no VM-sandbox propagation issues.
 *
 * Note: use `globalThis.harper.getContext`, not `globalThis.getContext` —
 * inside Harper VM component contexts, getContext lives on the `harper` export
 * object, not as a bare top-level global.
 */
export function recordDecisionDuration(ms) {
	const request = globalThis.harper?.getContext?.();
	if (request?.__serverTimingStore) {
		request.__serverTimingStore.decisionDur = ms;
	}
}
