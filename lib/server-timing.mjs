/**
 * Server-side accessor for the per-request Server-Timing store owned by the
 * server-timing Harper component (see server-timing/extension.mjs).
 *
 * Called from the Next.js render path (server components) to record how long
 * the fetch-and-customize "decision" step took; the middleware turns it into
 * a `decision;dur=<ms>` Server-Timing segment when headers are written.
 *
 * Shared via `process` (not `globalThis`) — see server-timing/extension.mjs
 * for why: Harper component scopes and the Next.js runtime do not share a
 * `globalThis`, but they share the `process` object by reference.
 */
export function recordDecisionDuration(ms) {
	const store = process.__originTiming?.als?.getStore();
	if (store) store.decisionDur = ms;
}
