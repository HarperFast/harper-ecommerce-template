/**
 * Harper HTTP middleware that publishes a `decision;dur=<ms>` segment on the
 * `Server-Timing` response header (issue #7).
 *
 * The middleware attaches a plain store object to `request.__serverTimingStore`
 * before calling next(). The lib accessor (lib/server-timing.mjs) finds this
 * store via Harper's getContext(), which returns the request object because
 * Harper's transaction() stores the request as its own ALS context value.
 * Both sides hold a reference to the same store{} object, so the timing
 * written during the render is readable in the middleware after next() returns.
 *
 * `globalThis.harper.getContext` (not `globalThis.getContext`) is the correct
 * path inside Harper VM-sandboxed component contexts: getContext lives in the
 * `harper` named export, not as a bare top-level global.
 */
export function start(options) {
	options.server.http((request, next) => {
		const store = {};
		request.__serverTimingStore = store;

		return (async () => {
			const response = await next(request);
			try {
				const log = globalThis.logger ?? console;

				log.info(`[server-timing] store.decisionDur=${store.decisionDur}`);

				log.info(`[server-timing] response.headers exists=${response?.headers != null}`);
				if (response?.headers != null) {
					const existing = typeof response.headers.get === 'function'
						? response.headers.get('server-timing')
						: response.headers['server-timing'];
					log.info(`[server-timing] response.headers current server-timing="${existing}"`);
				}

				log.info(`[server-timing] response.headers.append is function=${typeof response?.headers?.append === 'function'}`);

				if (store.decisionDur != null && response?.headers?.append) {
					response.headers.append('Server-Timing', `decision;dur=${Number(store.decisionDur).toFixed(1)}`);
				}
			} catch (err) {
				const log = globalThis.logger ?? console;
				log.error(`[server-timing] error: ${err?.message}`);
			}
			return response;
		})();
	});
}
