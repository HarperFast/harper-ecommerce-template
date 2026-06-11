/**
 * Harper HTTP middleware that publishes a `decision;dur=<ms>` segment on the
 * `Server-Timing` response header (issue #7).
 *
 * Two propagation paths for the timing value (see lib/server-timing.mjs):
 *
 * 1. Next.js render path — the timing value is recorded into an
 *    AsyncLocalStorage store established by this middleware. Works because the
 *    Next.js render runs within the `als.run(store, fn)` async context.
 *
 * 2. Harper resource path — Harper's transaction() stores the request as its
 *    own ALS context; getContext() returns it from within resource handlers.
 *    This middleware attaches `__serverTimingStore` to the request so the
 *    lib accessor can write there, then reads it back after next() returns.
 *    Used as fallback when the extension's ALS does not propagate across
 *    Harper's VM-sandbox boundary.
 *
 * The store handle lives on `process` rather than `globalThis`: Harper loads
 * components in sandboxed VM contexts whose `globalThis` is a per-scope
 * object, while the Next.js app is loaded in the real context. `process` is
 * shared by reference across all scopes.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export function start(options) {
	process.__originTiming ??= { als: new AsyncLocalStorage() };
	const { als } = process.__originTiming;

	options.server.http((request, next) => {
		const store = {};
		// Attach the store to the request so Harper resource handlers can write
		// to it via getContext().__serverTimingStore (path 2 fallback).
		request.__serverTimingStore = store;

		return als.run(store, async () => {
			const response = await next(request);
			try {
				// store.decisionDur is set via ALS (path 1).
				// request.__serverTimingStore.decisionDur is set via getContext() (path 2).
				// Both write to the same `store` object, so either path works.
				const decisionDur = store.decisionDur;
				if (decisionDur != null && response?.headers?.append) {
					response.headers.append('Server-Timing', `decision;dur=${Number(decisionDur).toFixed(1)}`);
				}
			} catch {
				// Timing instrumentation must never break the response.
			}
			return response;
		});
	});
}
