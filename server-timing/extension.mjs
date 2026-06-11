/**
 * Harper HTTP middleware that publishes a `decision;dur=<ms>` segment on the
 * `Server-Timing` response header (issue #7).
 *
 * App Router server components cannot set response headers directly, so the
 * personalized PDP records its fetch-and-customize elapsed time into a
 * per-request AsyncLocalStorage store (see lib/server-timing.mjs); this
 * middleware owns that store and appends the segment to the response headers
 * after the downstream handler completes.
 *
 * Harper's HTTP middleware receives a Fetch API-style Response whose
 * `headers.append()` correctly coalesces multi-value headers without
 * overwriting existing segments (e.g. `hdb;dur` added by Harper core).
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
		return als.run(store, async () => {
			const response = await next(request);
			try {
				if (store.decisionDur != null && response?.headers?.append) {
					response.headers.append('Server-Timing', `decision;dur=${Number(store.decisionDur).toFixed(1)}`);
				}
			} catch {
				// Timing instrumentation must never break the response.
			}
			return response;
		});
	});
}
