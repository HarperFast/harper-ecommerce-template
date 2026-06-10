/**
 * Unit tests for cacheHandler.cjs — retry and eviction logic.
 *
 * These run with Node's built-in test runner (node --test) and do not require
 * a running Harper instance. Each test loads a fresh copy of the module to
 * reset module-level state (invalidationTimes, pendingInvalidationWrites, etc.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import v8 from 'node:v8';
import { EventEmitter } from 'node:events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);
const HANDLER_PATH = path.join(__dirname, '..', 'cacheHandler.cjs');

function freshModule() {
	delete _require.cache[_require.resolve(HANDLER_PATH)];
	return _require(HANDLER_PATH);
}

function baseAppCache(overrides = {}) {
	return {
		Cache: { get: async () => null, put: async () => {}, delete: async () => {} },
		CacheRules: { search: async function* () {} },
		CacheInvalidation: {
			search: async function* () {},
			subscribe: async () => ({ on: () => {} }),
			put: async () => {},
			...overrides,
		},
	};
}

test('revalidateTag retries CacheInvalidation.put failures after the backoff delay', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

	const puts = [];
	let failOnce = true;

	globalThis.databases = {
		appCache: baseAppCache({
			put: async ({ id }) => {
				puts.push(id);
				if (failOnce) {
					failOnce = false;
					throw new Error('simulated DB failure');
				}
			},
		}),
	};
	t.after(() => { delete globalThis.databases; });

	const CacheHandler = freshModule();
	const handler = new CacheHandler({});

	// Trigger initialization (preloads empty CacheInvalidation table).
	await handler.get('/warmup');
	puts.length = 0;

	// revalidateTag: the put fails on the first attempt.
	failOnce = true;
	await handler.revalidateTag('pdp');

	assert.equal(puts.length, 1, 'first put was attempted');
	assert.equal(puts[0], 'pdp');

	// Advance past INVALIDATION_PUT_RETRY_MS (5 000 ms) to fire the retry timer.
	t.mock.timers.tick(5001);
	// Let the async retry batch complete (two ticks: one for the promise
	// microtask queue inside retryPendingInvalidations, one for safety).
	await new Promise((r) => setImmediate(r));
	await new Promise((r) => setImmediate(r));

	assert.equal(puts.length, 2, 'retry fired after backoff');
	assert.equal(puts[1], 'pdp', 'retry used the correct tag');
});

test('concurrent failures are all retried, not just the last one', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

	const puts = [];
	const failTags = new Set(['home', 'listing']);

	globalThis.databases = {
		appCache: baseAppCache({
			put: async ({ id }) => {
				puts.push(id);
				if (failTags.has(id)) {
					failTags.delete(id); // fail once per tag
					throw new Error('db down');
				}
			},
		}),
	};
	t.after(() => { delete globalThis.databases; });

	const CacheHandler = freshModule();
	const handler = new CacheHandler({});
	await handler.get('/warmup');
	puts.length = 0;

	await handler.revalidateTag(['home', 'listing', 'pdp']);

	// 3 first attempts; home and listing fail, pdp succeeds.
	assert.equal(puts.length, 3);

	t.mock.timers.tick(5001);
	await new Promise((r) => setImmediate(r));
	await new Promise((r) => setImmediate(r));

	// 2 retries fired (only the failed tags).
	assert.equal(puts.length, 5, 'retried only the failed tags');
	const retried = new Set(puts.slice(3));
	assert.ok(retried.has('home'), 'home retried');
	assert.ok(retried.has('listing'), 'listing retried');
	assert.ok(!retried.has('pdp'), 'pdp was not retried (already succeeded)');
});

test('get() escalates log level for persistent failures; corrupt blobs also increment the counter; resets only after full success', async (t) => {
	const logs = { trace: [], warn: [], error: [] };
	globalThis.logger = {
		trace: (m) => logs.trace.push(m),
		warn: (m) => logs.warn.push(m),
		error: (m) => logs.error.push(m),
	};
	t.after(() => { delete globalThis.logger; delete globalThis.databases; });

	let mode = 'db-fail'; // 'db-fail' | 'corrupt-blob' | 'hit'
	const corruptBlob = Buffer.from([0xff, 0xfe, 0xfd]); // not valid v8 data
	const validBlob = v8.serialize({ kind: 'APP_PAGE', html: 'ok' });

	const mockCache = {
		get: async () => {
			if (mode === 'db-fail') throw new Error('DB down');
			if (mode === 'corrupt-blob') return { data: corruptBlob, cacheTags: null, refreshedAt: 1, groupCode: null, url: null };
			// 'hit': returns a valid entry so the full pipeline (including deserialization) succeeds
			return { data: validBlob, cacheTags: null, refreshedAt: 1, groupCode: null, url: null };
		},
		put: async () => {},
		delete: async () => {},
	};

	globalThis.databases = { appCache: { ...baseAppCache(), Cache: mockCache } };

	const CacheHandler = freshModule();
	const handler = new CacheHandler({});

	// Drive 4 DB failures — trace only.
	for (let i = 0; i < 4; i++) await handler.get(`/products/${i}`);
	assert.equal(logs.warn.length, 0, 'no warn before threshold');
	assert.ok(logs.trace.some((m) => m.includes('degraded to MISS')), 'trace logged for early failures');

	// 5th failure — warn threshold.
	await handler.get('/products/5');
	assert.ok(logs.warn.some((m) => m.includes('consecutive failures')), 'warn at threshold');
	assert.equal(logs.error.length, 0, 'no error yet');

	// Drive to the error threshold (20 total).
	for (let i = 6; i <= 20; i++) await handler.get(`/products/${i}`);
	assert.ok(logs.error.some((m) => m.includes('cache outage')), 'error at high threshold');

	// Corrupt blob: DB responds but deserialization fails — counter must still increment
	// (not reset on a partial success). This would silently plateau at trace if the
	// reset fired after Cache.get() rather than after full deserialization success.
	mode = 'corrupt-blob';
	const errorCountMid = logs.error.length;
	await handler.get('/products/corrupt');
	assert.ok(logs.error.length > errorCountMid, 'corrupt blob still increments the counter and logs at error level');

	// Full success (real hit + deserialization): counter resets.
	mode = 'hit';
	await handler.get('/products/recover');
	mode = 'db-fail';

	// Next failure should be back at trace level (counter was reset to 0).
	const warnCountBefore = logs.warn.length;
	const errorCountBefore = logs.error.length;
	await handler.get('/products/after-reset');
	assert.equal(logs.warn.length, warnCountBefore, 'no new warn — counter restarted after full success');
	assert.equal(logs.error.length, errorCountBefore, 'no new error — counter restarted after full success');
});

test('subscription events with missing/non-numeric timestamps are ignored; valid timestamps are applied', async (t) => {
	const emitter = new EventEmitter();
	const warnings = [];

	// Patch globalThis.logger so warn() calls are captured.
	globalThis.logger = { warn: (msg) => warnings.push(msg), trace: () => {}, error: () => {} };
	t.after(() => { delete globalThis.logger; delete globalThis.databases; });

	const payload = v8.serialize({ kind: 'APP_PAGE', html: 'hello' });

	globalThis.databases = {
		appCache: {
			...baseAppCache({ subscribe: async () => emitter }),
			Cache: {
				get: async (key) =>
					key === '/products/1'
						? { data: payload, cacheTags: JSON.stringify(['sale']), refreshedAt: 100, groupCode: null, url: '/products/1' }
						: null,
				put: async () => {},
				delete: async () => {},
			},
		},
	};

	const CacheHandler = freshModule();
	const handler = new CacheHandler({});
	await handler.get('/warmup'); // trigger init + subscription

	// Emit a 'data' event with no timestamp — should be ignored.
	emitter.emit('data', { id: 'sale', value: {} });
	await new Promise((r) => setImmediate(r));

	// Entry has refreshedAt=100; invalidation was ignored so it should be a HIT.
	const hitResult = await handler.get('/products/1');
	assert.notEqual(hitResult, null, 'entry is served; malformed event was not applied');
	assert.ok(warnings.some((w) => w.includes('sale')), 'warn logged for malformed event');

	// Emit a valid event at timestamp=200 (after refreshedAt=100) — should invalidate.
	emitter.emit('data', { id: 'sale', value: { timestamp: 200 } });
	await new Promise((r) => setImmediate(r));

	const missResult = await handler.get('/products/1');
	assert.equal(missResult, null, 'entry is now invalidated by valid subscription event');
});

test('invalidationTimes entries older than 7 days are evicted by the hourly timer', async (t) => {
	// INVALIDATION_TTL_MS=604_800_000, INVALIDATION_EVICT_INTERVAL_MS=3_600_000.
	// At the 169th interval firing (T=608_400_000) the cutoff is 3_600_000,
	// which is greater than the invalidation timestamp of 0, so the entry is evicted.
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });

	const payload = v8.serialize({ kind: 'APP_PAGE', html: '<h1>hello</h1>' });

	globalThis.databases = {
		appCache: {
			...baseAppCache(),
			Cache: {
				get: async (key) =>
					key === '/products/1'
						? { data: payload, cacheTags: JSON.stringify(['sale']), refreshedAt: -1, groupCode: null, url: '/products/1' }
						: null,
				put: async () => {},
				delete: async () => {},
			},
		},
	};
	t.after(() => { delete globalThis.databases; });

	const CacheHandler = freshModule();
	const handler = new CacheHandler({});

	// T=0: initialize + stamp invalidation[sale]=0.
	await handler.get('/warmup');
	await handler.revalidateTag('sale');

	// Entry with refreshedAt=-1 is invalidated (invalidatedAt=0 >= -1).
	assert.equal(await handler.get('/products/1'), null, 'entry is invalidated before eviction');

	// Tick past 169 eviction intervals so the hourly cleanup runs with a cutoff
	// that exceeds the T=0 invalidation timestamp.
	t.mock.timers.tick(608_400_001);
	await new Promise((r) => setImmediate(r));

	const result = await handler.get('/products/1');
	assert.notEqual(result, null, 'entry is served after the invalidation is evicted');
	assert.deepEqual(result.value, { kind: 'APP_PAGE', html: '<h1>hello</h1>' });
});
