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

	void test('leaves headers untouched when no duration was recorded', async () => {
		const makeReq = createListener();
		const { request, listener } = makeReq();
		const response = createMockResponse('hdb;dur=3.1');

		await listener(request, async () => response);

		strictEqual(response.headers.get('server-timing'), 'hdb;dur=3.1');
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

	void test('customizeProductDescription keeps gpt-4o-mini and caps max_tokens', () => {
		const source = readFileSync(resolve(ROOT, 'app/actions.js'), 'utf8');
		ok(source.includes("model: 'gpt-4o-mini'"), 'expected OpenAI model parity with gpt-4o-mini');
		ok(/max_tokens:\s*\d+/.test(source), 'expected an explicit max_tokens cap on the completion');
	});
});
