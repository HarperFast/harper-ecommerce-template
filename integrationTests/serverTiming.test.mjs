/**
 * Unit tests for the Server-Timing decision;dur plumbing (issue #7).
 *
 * Exercises the REAL production modules:
 *   - server-timing/extension.mjs (Harper HTTP middleware owning the ALS store)
 *   - lib/server-timing.mjs (render-path accessor that records the duration)
 *
 * plus source-level wiring guards for the pieces that only take effect inside
 * a full Next.js/Harper boot (force-dynamic route config, Cache-Control
 * header, component ordering), which the integration harness cannot serve
 * (see integrationTests/fixture/config.yaml for why the Next plugin cannot
 * boot there).
 *
 * Harper's HTTP middleware uses a Fetch API-style Response whose
 * `headers.append()` coalesces multi-value headers without overwriting
 * existing segments added by Harper core (e.g. `hdb;dur`).
 */
import { suite, test } from 'node:test';
import { ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../server-timing/extension.mjs';
import { recordDecisionDuration } from '../lib/server-timing.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal Fetch API-style response mock with a multi-value-aware Headers.
function createMockResponse(initialHeaders = {}) {
	const map = new Map();
	for (const [k, v] of Object.entries(initialHeaders)) {
		map.set(k.toLowerCase(), v);
	}
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

// Registers the middleware and returns the listener.
function createListener() {
	let listener;
	start({ server: { http(fn) { listener = fn; } } });
	return listener;
}

void suite('server-timing middleware (server-timing/extension.mjs)', () => {
	void test('appends decision;dur to the response headers, propagating across awaits', async () => {
		const listener = createListener();
		const response = createMockResponse();

		await listener({}, async () => {
			await new Promise((r) => setTimeout(r, 5));
			recordDecisionDuration(42);
			return response;
		});

		strictEqual(response.headers.get('server-timing'), 'decision;dur=42.0');
	});

	void test('appends to an existing Server-Timing value without overwriting it', async () => {
		const listener = createListener();
		// Harper core adds its own segment before returning the response.
		const response = createMockResponse({ 'Server-Timing': 'hdb;dur=1.52' });

		await listener({}, async () => {
			recordDecisionDuration(7.25);
			return response;
		});

		strictEqual(response.headers.get('server-timing'), 'hdb;dur=1.52, decision;dur=7.3');
	});

	void test('leaves headers untouched when no decision duration was recorded', async () => {
		const listener = createListener();
		const response = createMockResponse({ 'Server-Timing': 'hdb;dur=3.1' });

		await listener({}, async () => response);

		strictEqual(response.headers.get('server-timing'), 'hdb;dur=3.1');
	});

	void test('returns the response from the next layer unchanged', async () => {
		const listener = createListener();
		const response = createMockResponse();
		const result = await listener({}, () => response);
		strictEqual(result, response);
	});

	void test('passes through responses without a headers.append method safely', async () => {
		const listener = createListener();
		// e.g. a plain string or symbol response — must not throw.
		const result = await listener({}, async () => {
			recordDecisionDuration(5);
			return 'plain-response';
		});
		strictEqual(result, 'plain-response');
	});

	void test('keeps concurrent request stores isolated', async () => {
		const listener = createListener();
		const first = createMockResponse();
		const second = createMockResponse();

		await Promise.all([
			listener({}, async () => {
				await new Promise((r) => setTimeout(r, 10));
				recordDecisionDuration(11);
				return first;
			}),
			listener({}, async () => {
				recordDecisionDuration(22);
				await new Promise((r) => setTimeout(r, 15));
				return second;
			}),
		]);

		strictEqual(first.headers.get('server-timing'), 'decision;dur=11.0');
		strictEqual(second.headers.get('server-timing'), 'decision;dur=22.0');
	});
});

void suite('recordDecisionDuration (lib/server-timing.mjs)', () => {
	void test('is a safe no-op outside a request context', () => {
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
		ok(serverTimingIndex < nextjsIndex, 'expected server-timing to load before the Next.js plugin so its ALS context wraps the render');
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
