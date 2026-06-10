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
 */
import { suite, test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../server-timing/extension.mjs';
import { recordDecisionDuration } from '../lib/server-timing.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function createNodeResponse() {
	return {
		headers: new Map(),
		writeHeadCalls: [],
		getHeader(name) {
			return this.headers.get(name.toLowerCase());
		},
		setHeader(name, value) {
			this.headers.set(name.toLowerCase(), value);
		},
		writeHead(...args) {
			this.writeHeadCalls.push(args);
			return this;
		},
	};
}

// Registers the middleware against a stub server and returns the listener.
function createListener() {
	let listener;
	start({
		server: {
			http(fn) {
				listener = fn;
			},
		},
	});
	return listener;
}

void suite('server-timing middleware (server-timing/extension.mjs)', () => {
	void test('appends decision;dur recorded during the request, across awaits', async () => {
		const listener = createListener();
		const nodeResponse = createNodeResponse();

		await listener({ _nodeResponse: nodeResponse }, async () => {
			// The ALS context must survive awaits, like a real Next.js render.
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
			recordDecisionDuration(42);
			return 'response';
		});

		nodeResponse.writeHead(200);
		strictEqual(nodeResponse.getHeader('Server-Timing'), 'decision;dur=42.0');
		strictEqual(nodeResponse.writeHeadCalls.length, 1, 'expected the original writeHead to be called');
		strictEqual(nodeResponse.writeHeadCalls[0][0], 200, 'expected writeHead args to pass through');
	});

	void test('appends to an existing Server-Timing value instead of overwriting it', async () => {
		const listener = createListener();
		const nodeResponse = createNodeResponse();

		await listener({ _nodeResponse: nodeResponse }, async () => {
			recordDecisionDuration(7.25);
			return 'response';
		});

		// e.g. Harper core's own segment, set before headers are flushed.
		nodeResponse.setHeader('Server-Timing', 'origin;dur=120.5');
		nodeResponse.writeHead(200);
		strictEqual(nodeResponse.getHeader('Server-Timing'), 'origin;dur=120.5, decision;dur=7.3');
	});

	void test('leaves Server-Timing untouched when no decision duration was recorded', async () => {
		const listener = createListener();
		const nodeResponse = createNodeResponse();

		await listener({ _nodeResponse: nodeResponse }, async () => 'response');

		nodeResponse.setHeader('Server-Timing', 'origin;dur=3.1');
		nodeResponse.writeHead(200);
		strictEqual(nodeResponse.getHeader('Server-Timing'), 'origin;dur=3.1');
		strictEqual(nodeResponse.writeHeadCalls.length, 1);
	});

	void test('passes requests without a node response straight through', async () => {
		const listener = createListener();
		const sentinel = Symbol('response');
		const result = await listener({}, () => sentinel);
		strictEqual(result, sentinel);
	});

	void test('returns the next layer\'s response', async () => {
		const listener = createListener();
		const nodeResponse = createNodeResponse();
		const sentinel = Symbol('response');
		const result = await listener({ _nodeResponse: nodeResponse }, () => sentinel);
		strictEqual(result, sentinel);
	});

	void test('merges into a [name, value] entries headers argument (Harper core fast path)', async () => {
		const listener = createListener();
		const nodeResponse = createNodeResponse();

		await listener({ _nodeResponse: nodeResponse }, async () => {
			recordDecisionDuration(42);
			return 'response';
		});

		// Harper core writes chain responses as writeHead(status, Array.from(headers)),
		// an array of [name, value] entries that Node treats as authoritative.
		const headersArgument = [
			['Content-Type', 'application/json'],
			['Server-Timing', 'hdb;dur=1.23'],
		];
		nodeResponse.writeHead(200, headersArgument);
		deepStrictEqual(headersArgument[1], ['Server-Timing', 'hdb;dur=1.23, decision;dur=42.0']);
		// The header must ride the argument; setHeader would create the
		// progressive-API state that makes Node reject nested header arrays.
		strictEqual(nodeResponse.headers.size, 0, 'expected no setHeader call when a headers argument is present');
	});

	void test('merges into flat-array and object headers arguments, and reason-phrase form', async () => {
		const listener = createListener();

		const flatResponse = createNodeResponse();
		await listener({ _nodeResponse: flatResponse }, async () => {
			recordDecisionDuration(1);
			return 'response';
		});
		const flatHeaders = ['Server-Timing', 'hdb;dur=9.99', 'Content-Type', 'text/html'];
		flatResponse.writeHead(200, flatHeaders);
		strictEqual(flatHeaders[1], 'hdb;dur=9.99, decision;dur=1.0');

		const objectResponse = createNodeResponse();
		await listener({ _nodeResponse: objectResponse }, async () => {
			recordDecisionDuration(2);
			return 'response';
		});
		const objectHeaders = { 'server-timing': 'cache;desc=hit' };
		objectResponse.writeHead(200, 'OK', objectHeaders);
		strictEqual(objectHeaders['server-timing'], 'cache;desc=hit, decision;dur=2.0');

		const missingResponse = createNodeResponse();
		await listener({ _nodeResponse: missingResponse }, async () => {
			recordDecisionDuration(3);
			return 'response';
		});
		const missingHeaders = { 'Content-Type': 'text/html' };
		missingResponse.writeHead(200, missingHeaders);
		strictEqual(missingHeaders['Server-Timing'], 'decision;dur=3.0');
	});

	void test('does not break a real ServerResponse written the way Harper core writes it', async () => {
		// Regression guard: Node rejects nested header arrays once setHeader has
		// been used on the response, so the middleware must never setHeader when
		// a headers argument is present. Reproduce Harper's exact fast path
		// (writeHead(status, [[name, value], ...]) on a pristine response).
		const listener = createListener();
		const nodeResponse = new ServerResponse(new IncomingMessage(null));

		await listener({ _nodeResponse: nodeResponse }, async () => {
			recordDecisionDuration(42);
			return 'response';
		});

		nodeResponse.writeHead(200, [
			['Content-Type', 'application/json'],
			['Server-Timing', 'hdb;dur=1.23'],
		]);
		ok(nodeResponse._header.includes('Server-Timing: hdb;dur=1.23, decision;dur=42.0'),
			`expected the merged Server-Timing header, got: ${JSON.stringify(nodeResponse._header)}`);
	});

	void test('keeps concurrent request stores isolated', async () => {
		const listener = createListener();
		const first = createNodeResponse();
		const second = createNodeResponse();

		await Promise.all([
			listener({ _nodeResponse: first }, async () => {
				await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
				recordDecisionDuration(11);
				return 'a';
			}),
			listener({ _nodeResponse: second }, async () => {
				recordDecisionDuration(22);
				await new Promise((resolveDelay) => setTimeout(resolveDelay, 15));
				return 'b';
			}),
		]);

		first.writeHead(200);
		second.writeHead(200);
		strictEqual(first.getHeader('Server-Timing'), 'decision;dur=11.0');
		strictEqual(second.getHeader('Server-Timing'), 'decision;dur=22.0');
	});
});

void suite('recordDecisionDuration (lib/server-timing.mjs)', () => {
	void test('is a safe no-op outside a request context', () => {
		// Must never throw when called without the middleware's ALS context
		// (e.g. during build-time rendering).
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
