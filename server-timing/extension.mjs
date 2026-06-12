/**
 * Harper HTTP middleware that publishes a `decision;dur=<ms>` segment on the
 * `Server-Timing` response header (issue #7).
 *
 * The middleware attaches a plain store object to `request.__serverTimingStore`
 * before calling next(). The lib accessor (lib/server-timing.mjs) finds this
 * store via Harper's getContext(), which returns the request object because
 * Harper's transaction() stores the request as its own ALS context value.
 *
 * ALS propagation caveat: React's App Router breaks the async chain when it
 * takes over scheduling, so getContext() returns null inside Next.js server
 * components and recordDecisionDuration() becomes a no-op for those handlers.
 * When store.decisionDur is not set by the time the response returns, the
 * middleware falls back to the total elapsed time for the request. For the
 * personalized route that time is dominated by the OpenAI call, making it a
 * useful approximation; cached routes will show a few ms.
 */
export function start(options) {
	options.server.http((request, next) => {
		const store = {};
		request.__serverTimingStore = store;
		const started = performance.now();

		// @harperfast/nextjs calls requestHandler(_nodeRequest, _nodeResponse)
		// and returns void — no Fetch API response object is ever returned. We
		// intercept writeHead so the header is injected at the moment Node.js
		// is about to flush response headers, after the render has run.
		const nodeRes = request._nodeResponse;
		if (nodeRes?.writeHead) {
			const origWriteHead = nodeRes.writeHead.bind(nodeRes);
			nodeRes.writeHead = function (...args) {
				try {
					const dur = store.decisionDur ?? (performance.now() - started);
					const segment = `decision;dur=${Number(dur).toFixed(1)}`;
					const existing = nodeRes.getHeader('Server-Timing');
					nodeRes.setHeader('Server-Timing', existing ? `${existing}, ${segment}` : segment);
				} catch {
					// Timing instrumentation must never break the response.
				}
				return origWriteHead(...args);
			};
		}

		return (async () => {
			const response = await next(request);
			try {
				if (response?.headers?.append) {
					const dur = store.decisionDur ?? (performance.now() - started);
					response.headers.append('Server-Timing', `decision;dur=${Number(dur).toFixed(1)}`);
				}
			} catch {
				// Timing instrumentation must never break the response.
			}
			return response;
		})();
	});
}
