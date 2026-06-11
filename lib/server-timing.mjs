/**
 * Server-side accessor for the per-request Server-Timing store owned by the
 * server-timing Harper component (see server-timing/extension.mjs).
 *
 * Called from the Next.js render path (server components) to record how long
 * the fetch-and-customize "decision" step took; the middleware turns it into
 * a `decision;dur=<ms>` Server-Timing segment on the response.
 *
 * Two propagation paths:
 *
 * 1. Next.js render path — the extension registers an ALS store via
 *    `process.__originTiming.als` and this accessor reads it with
 *    `als.getStore()`. Works because the render runs within the
 *    `als.run(store, fn)` async context established by the middleware.
 *
 * 2. Harper resource path (integration tests, Harper-native resources) —
 *    Harper's `transaction()` stores the request object in its own ALS and
 *    `globalThis.getContext()` returns it. The extension attaches the timing
 *    store to `request.__serverTimingStore`; this accessor reads the same
 *    property via the context. Works even when the extension's ALS does not
 *    propagate across Harper's VM-sandbox boundary.
 */
export function recordDecisionDuration(ms) {
	// Path 1: try the extension's ALS store (Next.js render context).
	const store = process.__originTiming?.als?.getStore();
	if (store) {
		store.decisionDur = ms;
		return;
	}
	// Path 2: Harper's transaction() stores the request as its context;
	// getContext() returns it. The extension attaches __serverTimingStore to
	// the request before calling next(), so it is always present here.
	const request = globalThis.getContext?.();
	if (request?.__serverTimingStore) {
		request.__serverTimingStore.decisionDur = ms;
	}
}
