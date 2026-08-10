/**
 * Server-side accessor for the per-request Server-Timing store (issue #7).
 *
 * Called from the Next.js personalized route to record the fetch-and-customize
 * elapsed time. The server-timing Harper component (extension.mjs) attaches
 * `__serverTimingStore` to the current request before the render starts, then
 * appends `decision;dur=<ms>` to the response headers after next() returns.
 *
 * `globalThis.harper.getContext()` retrieves the current context, giving this
 * accessor a reference to the same store{} object the middleware holds — no
 * separate ALS needed, no VM-sandbox propagation issues.
 *
 * What getContext() returns is not one fixed shape. Called from HTTP middleware
 * it can be the request itself; called from inside a resource method it is the
 * resource's context, which links to the originating request via `request` /
 * `requestContext`. Harper 5.2.1 hands resource methods the latter, so looking
 * only at the top-level object silently found nothing and this became a no-op
 * (the middleware then fell back to total elapsed time). Walk the chain instead.
 *
 * Note: use `globalThis.harper.getContext`, not `globalThis.getContext` —
 * inside Harper VM component contexts, getContext lives on the `harper` export
 * object, not as a bare top-level global.
 */
function findStore(context) {
	const seen = new Set();
	let ctx = context;
	while (ctx && typeof ctx === 'object' && !seen.has(ctx)) {
		seen.add(ctx);
		if (ctx.__serverTimingStore) return ctx.__serverTimingStore;
		ctx = ctx.requestContext ?? ctx.request ?? ctx.getContext?.();
	}
	return null;
}

export function recordDecisionDuration(ms) {
	// Prefer the AsyncLocalStorage the middleware runs the request inside; fall back to
	// walking whatever getContext() returns.
	const store = globalThis.__serverTimingALS?.getStore() ?? findStore(globalThis.harper?.getContext?.());
	if (store) {
		store.decisionDur = ms;
	}
}
