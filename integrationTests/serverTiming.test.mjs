/**
 * Unit tests for the Server-Timing decision;dur plumbing (issue #7).
 *
 * The middleware attaches a store to request.__serverTimingStore; the lib
 * accessor finds it via globalThis.harper.getContext() (Harper's transaction()
 * stores the request as its ALS context, and getContext is on the `harper`
 * global, not the bare globalThis). Both hold a reference to the same object.
 */
import { suite, test } from 'node:test';
import { ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../server-timing/extension.mjs';
import { recordDecisionDuration } from '../lib/server-timing.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal Fetch API-style response mock.
function createMockResponse(initialServerTiming) {
	const map = new Map();
	if (initialServerTiming) map.set('server-timing', initialServerTiming);
	const headers = {
		append(name, value) {
			const key = name.toLowerCase();
			const existing = map.get(key);
			map.set(key, existing ? `${existing}, ${value}` : value);
		},
		get(name) {
			return map.get(name.toLowerCase()) ?? null;
		},
	};
	return { headers };
}

// Register middleware and return the listener + a mock request factory.
function createListener() {
	let listener;
	start({ server: { http(fn) { listener = fn; } } });
	// Return a factory so each test gets a fresh request with its own store.
	return (extraProps = {}) => {
		const request = { ...extraProps };
		return { request, listener };
	};
}

// Simulate Harper's getContext() by wiring globalThis.harper.getContext to
// return the request object (as Harper's transaction() does at runtime).
function withHarperContext(request, fn) {
	globalThis.harper = { getContext: () => request };
	try {
		return fn();
	} finally {
		delete globalThis.harper;
	}
}

void suite('server-timing middleware (server-timing/extension.mjs)', () => {
	void test('appends decision;dur after the downstream handler records the duration', async () => {
		const makeReq = createListener();
		const { request, listener } = makeReq();
		const response = createMockResponse();

		await listener(request, async () => {
			withHarperContext(request, () => recordDecisionDuration(42));
			return response;
		});

		strictEqual(response.headers.get('server-timing'), 'decision;dur=42.0');
	});

	void test('appends to an existing Server-Timing value without overwriting it', async () => {
		const makeReq = createListener();
		const { request, listener } = makeReq();
		const response = createMockResponse('hdb;dur=1.52');

		await listener(request, async () => {
			withHarperContext(request, () => recordDecisionDuration(7.25));
			return response;
		});

		strictEqual(response.headers.get('server-timing'), 'hdb;dur=1.52, decision;dur=7.3');
	});

	void test('falls back to elapsed request time when no duration was explicitly recorded', async () => {
		const makeReq = createListener();
		const { request, listener } = makeReq();
		const response = createMockResponse('hdb;dur=3.1');

		await listener(request, async () => response);

		// Upstream hdb segment must be preserved and decision;dur must be appended
		// (elapsed fallback — exact value is timing-dependent so we pattern-check).
		const st = response.headers.get('server-timing');
		ok(st?.startsWith('hdb;dur=3.1, decision;dur='), `expected elapsed fallback, got: ${st}`);
	});

	void test('returns the response from the next layer unchanged', async () => {
		const makeReq = createListener();
		const { request, listener } = makeReq();
		const response = createMockResponse();
		const result = await listener(request, () => response);
		strictEqual(result, response);
	});

	void test('does not throw when response lacks headers.append', async () => {
		const makeReq = createListener();
		const { request, listener } = makeReq();

		const result = await listener(request, async () => {
			withHarperContext(request, () => recordDecisionDuration(5));
			return 'plain-response';
		});
		strictEqual(result, 'plain-response');
	});

	void test('passes upstream Link and Server-Timing headers through unchanged (issue #8)', async () => {
		const makeReq = createListener();
		const { request, listener } = makeReq();
		const upstreamLink = '<https://images.unsplash.com>; rel=preconnect';
		const response = createMockResponse('upstream;dur=1.0');
		response.headers.append('Link', upstreamLink);

		await listener(request, async () => {
			withHarperContext(request, () => recordDecisionDuration(3));
			return response;
		});

		strictEqual(response.headers.get('link'), upstreamLink, 'Link must never be stripped or rewritten');
		strictEqual(
			response.headers.get('server-timing'),
			'upstream;dur=1.0, decision;dur=3.0',
			'Server-Timing must be appended to, never replaced'
		);
	});

	void test('keeps concurrent request stores isolated', async () => {
		const makeReq = createListener();
		const { request: req1, listener } = makeReq();
		const { request: req2 } = makeReq();
		const resp1 = createMockResponse();
		const resp2 = createMockResponse();

		await Promise.all([
			listener(req1, async () => {
				await new Promise((r) => setTimeout(r, 10));
				withHarperContext(req1, () => recordDecisionDuration(11));
				return resp1;
			}),
			listener(req2, async () => {
				withHarperContext(req2, () => recordDecisionDuration(22));
				await new Promise((r) => setTimeout(r, 15));
				return resp2;
			}),
		]);

		strictEqual(resp1.headers.get('server-timing'), 'decision;dur=11.0');
		strictEqual(resp2.headers.get('server-timing'), 'decision;dur=22.0');
	});
});

// Stub that mirrors the Node.js ServerResponse header API without needing a
// real socket. This exercises the _nodeResponse path that @harperfast/nextjs
// takes at runtime (it calls requestHandler(_nodeRequest, _nodeResponse) and
// returns void — never a Fetch API response object).
function createNodeResponseStub(initialServerTiming) {
	const headers = new Map();
	if (initialServerTiming) headers.set('server-timing', initialServerTiming);
	return {
		setHeader(name, value) { headers.set(name.toLowerCase(), value); },
		getHeader(name) { return headers.get(name.toLowerCase()) ?? undefined; },
		writeHead(statusCode, ...rest) {
			this.statusCode = statusCode;
			// merge any headers passed directly to writeHead (mirrors Node.js semantics)
			const last = rest[rest.length - 1];
			if (last && typeof last === 'object' && !Array.isArray(last)) {
				for (const [k, v] of Object.entries(last)) headers.set(k.toLowerCase(), v);
			}
		},
	};
}

void suite('server-timing middleware — Node.js _nodeResponse path (real Harper+Next.js behavior)', () => {
	// @harperfast/nextjs calls requestHandler(_nodeRequest, _nodeResponse) and
	// returns void. The middleware's Fetch-API guard (response?.headers?.append)
	// never fires. These tests exercise the writeHead-interception path that
	// makes the header visible in the actual running app.

	void test('injects decision;dur via writeHead when next() writes to _nodeResponse and returns undefined', async () => {
		const makeReq = createListener();
		const { request, listener } = makeReq();
		const nodeRes = createNodeResponseStub();
		request._nodeResponse = nodeRes;

		await listener(request, async (req) => {
			withHarperContext(req, () => recordDecisionDuration(42));
			nodeRes.writeHead(200);
			return undefined;
		});

		strictEqual(nodeRes.getHeader('server-timing'), 'decision;dur=42.0');
	});

	void test('falls back to elapsed time when recordDecisionDuration was not called', async () => {
		const makeReq = createListener();
		const { request, listener } = makeReq();
		const nodeRes = createNodeResponseStub();
		request._nodeResponse = nodeRes;

		await listener(request, async () => {
			nodeRes.writeHead(200);
			return undefined;
		});

		const st = nodeRes.getHeader('server-timing');
		ok(st?.startsWith('decision;dur='), `expected elapsed fallback, got: ${st}`);
	});

	void test('appends to an existing Server-Timing already set on _nodeResponse', async () => {
		const makeReq = createListener();
		const { request, listener } = makeReq();
		const nodeRes = createNodeResponseStub('hdb;dur=1.5');
		request._nodeResponse = nodeRes;

		await listener(request, async (req) => {
			withHarperContext(req, () => recordDecisionDuration(7));
			nodeRes.writeHead(200);
			return undefined;
		});

		strictEqual(nodeRes.getHeader('server-timing'), 'hdb;dur=1.5, decision;dur=7.0');
	});

	void test('preserves all other writeHead arguments (status code, statusMessage, extra headers)', async () => {
		const makeReq = createListener();
		const { request, listener } = makeReq();
		const nodeRes = createNodeResponseStub();
		request._nodeResponse = nodeRes;

		await listener(request, async (req) => {
			withHarperContext(req, () => recordDecisionDuration(3));
			nodeRes.writeHead(201, 'Created', { 'X-Custom': 'yes' });
			return undefined;
		});

		strictEqual(nodeRes.statusCode, 201);
		strictEqual(nodeRes.getHeader('x-custom'), 'yes');
		strictEqual(nodeRes.getHeader('server-timing'), 'decision;dur=3.0');
	});

	void test('does not double-inject when next() returns a Fetch API response AND _nodeResponse is absent', async () => {
		// Sanity check: Fetch API path still works on its own (no _nodeResponse).
		const makeReq = createListener();
		const { request, listener } = makeReq();
		const response = createMockResponse();

		await listener(request, async (req) => {
			withHarperContext(req, () => recordDecisionDuration(10));
			return response;
		});

		strictEqual(response.headers.get('server-timing'), 'decision;dur=10.0');
	});

	void test('does not throw when _nodeResponse.writeHead is called after headers conceptually sent', async () => {
		const makeReq = createListener();
		const { request, listener } = makeReq();
		const nodeRes = createNodeResponseStub();
		nodeRes.setHeader = () => { throw new Error('headers already sent'); };
		request._nodeResponse = nodeRes;

		// Should not throw — the try/catch in the interceptor must absorb the error.
		await listener(request, async () => {
			nodeRes.writeHead(200);
			return undefined;
		});
	});
});

void suite('recordDecisionDuration (lib/server-timing.mjs)', () => {
	void test('writes to request.__serverTimingStore via globalThis.harper.getContext', () => {
		const store = {};
		const mockRequest = { __serverTimingStore: store };
		globalThis.harper = { getContext: () => mockRequest };
		try {
			recordDecisionDuration(99);
			strictEqual(store.decisionDur, 99);
		} finally {
			delete globalThis.harper;
		}
	});

	void test('is a safe no-op when harper context is unavailable', () => {
		// No globalThis.harper — must not throw.
		recordDecisionDuration(5);
	});
});

void suite('personalized route wiring (source-level guards)', () => {
	void test('personalized page is force-dynamic and records the decision duration server-side', () => {
		const source = readFileSync(resolve(ROOT, 'app/products/[id]/personalized/page.js'), 'utf8');
		ok(source.includes("export const dynamic = 'force-dynamic'"), 'expected the route to opt out of static rendering');
		ok(source.includes('recordDecisionDuration('), 'expected the route to record the decision duration');
		ok(source.includes('customizeProductDescription('), 'expected the route to personalize during the render');
		ok(source.includes('serverPersonalized'), 'expected the route to mark the product as server-personalized');
	});

	void test('product page suppresses client personalization when serverPersonalized', () => {
		const source = readFileSync(resolve(ROOT, 'app/products/[id]/product-page.js'), 'utf8');
		ok(source.includes('serverPersonalized = false'), 'expected serverPersonalized to default off for the standard PDP');
		ok(source.includes('aiPersonalizationEnabled && !serverPersonalized'), 'expected the client OpenAI effect to be skipped when server-personalized');
	});

	void test('config.yaml wires the server-timing component before the Next.js plugin', () => {
		const source = readFileSync(resolve(ROOT, 'config.yaml'), 'utf8');
		const serverTimingIndex = source.indexOf('server-timing:');
		const nextjsIndex = source.indexOf("'@harperfast/nextjs':");
		ok(serverTimingIndex !== -1, 'expected the server-timing component to be configured');
		ok(nextjsIndex !== -1, 'expected the Next.js plugin to be configured');
		ok(serverTimingIndex < nextjsIndex, 'expected server-timing to load before the Next.js plugin');
	});

	void test('next.config.js sends Cache-Control: no-store for the personalized route', () => {
		const source = readFileSync(resolve(ROOT, 'next.config.js'), 'utf8');
		ok(source.includes("'/products/:id/personalized'"), 'expected a headers() rule for the personalized route');
		ok(source.includes('no-store'), 'expected the personalized route to be marked no-store');
	});

	void test('server-timing extension only appends headers and never emits Early Hints (issue #8)', () => {
		const source = readFileSync(resolve(ROOT, 'server-timing/extension.mjs'), 'utf8');
		ok(source.includes("headers.append('Server-Timing'"), 'expected the decision;dur segment to be appended');
		ok(!source.includes('headers.set'), 'extension must never overwrite headers with headers.set');
		ok(!source.includes('headers.delete'), 'extension must never strip headers with headers.delete');
		ok(!source.includes('writeEarlyHints'), 'the app must not emit HTTP 103 — Early Hints are emitted upstream');
	});

	void test('customizeProductDescription keeps gpt-4o-mini and caps max_tokens', () => {
		const source = readFileSync(resolve(ROOT, 'app/actions.js'), 'utf8');
		ok(source.includes("model: 'gpt-4o-mini'"), 'expected OpenAI model parity with gpt-4o-mini');
		ok(/max_tokens:\s*\d+/.test(source), 'expected an explicit max_tokens cap on the completion');
	});
});
