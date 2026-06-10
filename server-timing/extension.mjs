/**
 * Harper HTTP middleware that publishes a `decision;dur=<ms>` segment on the
 * `Server-Timing` response header (issue #7).
 *
 * App Router server components cannot set response headers directly, so the
 * personalized PDP records its fetch-and-customize elapsed time into a
 * per-request AsyncLocalStorage store (see lib/server-timing.mjs); this
 * middleware owns that store and appends the segment when response headers
 * are written. It must be wired in config.yaml BEFORE the @harperfast/nextjs
 * plugin so its ALS context wraps the Next.js render.
 *
 * The store handle lives on `process` rather than `globalThis`: Harper loads
 * components in sandboxed VM contexts whose `globalThis` is a per-scope
 * object, while the Next.js build is loaded via native require in the real
 * context. `process` is copied by reference into every scope, so it is the
 * one slot both sides observe.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const SERVER_TIMING = 'server-timing';

// Append `addition` to a headers argument passed to writeHead, in place,
// preserving any existing Server-Timing value. Node treats a headers argument
// as authoritative (array form removes, object form overwrites, same-named
// headers set via setHeader), so when one is present the segment must be
// merged into it rather than set on the response. Supports all three Node
// forms: flat array, array of [name, value] entries, and plain object.
function appendToHeadersArgument(headersArgument, addition) {
	if (Array.isArray(headersArgument)) {
		if (headersArgument.length && Array.isArray(headersArgument[0])) {
			// Array of [name, value] entries (what Harper core passes).
			for (const entry of headersArgument) {
				if (String(entry[0]).toLowerCase() === SERVER_TIMING) {
					entry[1] = appendValue(entry[1], addition);
					return;
				}
			}
			headersArgument.push(['Server-Timing', addition]);
			return;
		}
		// Flat [name, value, name, value, ...] array.
		for (let index = 0; index + 1 < headersArgument.length; index += 2) {
			if (String(headersArgument[index]).toLowerCase() === SERVER_TIMING) {
				headersArgument[index + 1] = appendValue(headersArgument[index + 1], addition);
				return;
			}
		}
		headersArgument.push('Server-Timing', addition);
		return;
	}
	for (const name of Object.keys(headersArgument)) {
		if (name.toLowerCase() === SERVER_TIMING) {
			headersArgument[name] = appendValue(headersArgument[name], addition);
			return;
		}
	}
	headersArgument['Server-Timing'] = addition;
}

// A header value may be an array (one element per header line); keep it one.
function appendValue(value, addition) {
	return Array.isArray(value) ? [...value, addition] : `${value}, ${addition}`;
}

export function start(options) {
	process.__originTiming ??= { als: new AsyncLocalStorage() };
	const { als } = process.__originTiming;

	options.server.http((request, next) => {
		const nodeResponse = request._nodeResponse;
		if (!nodeResponse) return next(request);

		const store = {};

		const originalWriteHead = nodeResponse.writeHead;
		nodeResponse.writeHead = function (...args) {
			try {
				if (store.decisionDur != null && !store.decisionAppended && !nodeResponse.headersSent) {
					store.decisionAppended = true;
					const addition = `decision;dur=${Number(store.decisionDur).toFixed(1)}`;
					// writeHead(status[, reasonPhrase][, headers])
					const headersArgument = typeof args[1] === 'string' ? args[2] : args[1];
					if (headersArgument && typeof headersArgument === 'object') {
						appendToHeadersArgument(headersArgument, addition);
					} else {
						// No headers argument: append to (or create) the header on the
						// response itself, preserving segments set by earlier layers.
						const existing = nodeResponse.getHeader('Server-Timing');
						nodeResponse.setHeader('Server-Timing', existing ? `${existing}, ${addition}` : addition);
					}
				}
			} catch {
				// Timing instrumentation must never break the response.
			}
			return originalWriteHead.apply(nodeResponse, args);
		};

		return als.run(store, () => next(request));
	});
}
