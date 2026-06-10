import { suite, test, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import {
	setupHarperWithFixture,
	teardownHarper,
	type ContextWithHarper,
} from '@harperfast/integration-testing';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { copyFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Use the data-layer fixture (schema + seed, no @harperfast/nextjs plugin) rather
// than the repo root. The plugin builds/serves Next.js on boot, which spawns build
// workers that contend for the RocksDB lock the test Harper process already holds
// (known `next build` lock conflict) and owns the HTTP port. We verify the data
// layer the v4->v5 migration touched directly via the Operations API; see fixture
// config.yaml for the full rationale.
const FIXTURE_PATH = resolve(__dirname, 'fixture');

// The `harper` package's `exports` map only exposes ".", so the harness's
// auto-resolution of 'harper/dist/bin/harper.js' fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
// Resolve the CLI from the (exported) main entry and pass it explicitly.
const require = createRequire(import.meta.url);
const harperBinPath = resolve(dirname(require.resolve('harper')), 'bin/harper.js');

// POST an operation to the Operations API with admin Basic auth and assert HTTP 200.
// (The packaged sendOperation() helper posts without auth, which the Operations API
// rejects, so we use the instance's admin credentials directly.)
async function op<T = unknown>(ctx: ContextWithHarper, operation: Record<string, unknown>): Promise<T> {
	const { operationsAPIURL, admin } = ctx.harper;
	const creds = Buffer.from(`${admin.username}:${admin.password}`).toString('base64');
	const res = await fetch(operationsAPIURL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Basic ${creds}` },
		body: JSON.stringify(operation),
	});
	const body = (await res.json()) as T;
	strictEqual(res.status, 200, `operation ${operation.operation as string} failed: ${JSON.stringify(body)}`);
	return body;
}

// The real app runs the @harperfast/nextjs plugin, which owns the HTTP port and
// intercepts all HTTP routes, and builds Next.js on boot (incompatible with the
// ephemeral test harness — see fixture config.yaml). These tests load only the
// data-layer fixture and exercise the Harper tables/schema/seed/CRUD through the
// Operations API, the stable surface for verifying the v4->v5 migration.
void suite('Harper ecommerce template data layer (v5)', (ctx: ContextWithHarper) => {
	before(async () => {
		// The fixture's resources.js exercises the REAL repo-root cache handler
		// against live Harper tables (Blob round-trip, rules, invalidation). Copy
		// it in here because Harper restricts a component to files inside its own
		// directory; the copy is gitignored so the production file stays the
		// single source of truth.
		copyFileSync(resolve(__dirname, '../cacheHandler.cjs'), resolve(FIXTURE_PATH, 'cacheHandler.cjs'));
		await setupHarperWithFixture(ctx, FIXTURE_PATH, { harperBinPath });
	});

	after(async () => {
		await teardownHarper(ctx);
	});

	void test('Harper boots with the schema and seeds the Product table', async () => {
		// resources.js seeds 15 products from productdata.json on first boot.
		const result = (await op(ctx, {
			operation: 'search_by_conditions',
			database: 'data',
			table: 'Product',
			operator: 'and',
			get_attributes: ['id', 'name', 'category', 'price'],
			conditions: [
				{ search_attribute: 'id', search_type: 'greater_than_equal', search_value: '0' },
			],
		})) as Array<{ id: string }>;
		ok(Array.isArray(result), 'expected an array of products');
		ok(result.length >= 15, `expected at least 15 seeded products, got ${result.length}`);
	});

	void test('Product.get returns a seeded record by id', async () => {
		const result = (await op(ctx, {
			operation: 'search_by_id',
			database: 'data',
			table: 'Product',
			ids: ['11'],
			get_attributes: ['id', 'name', 'category', 'price', 'specs'],
		})) as Array<{ id: string; name: string; category: string; price: number }>;
		strictEqual(result.length, 1, 'expected exactly one product for id 11');
		strictEqual(result[0].id, '11');
		strictEqual(result[0].name, 'Portable Laptop Stand');
		strictEqual(result[0].category, 'Accessories');
	});

	void test('Traits table is seeded with the default user traits', async () => {
		const result = (await op(ctx, {
			operation: 'search_by_id',
			database: 'data',
			table: 'Traits',
			ids: ['1'],
			get_attributes: ['id', 'traits'],
		})) as Array<{ id: string; traits: string[] }>;
		strictEqual(result.length, 1, 'expected exactly one Traits record for id 1');
		strictEqual(result[0].id, '1');
		ok(Array.isArray(result[0].traits), 'expected traits to be an array');
		ok(result[0].traits.includes('sporty'), 'expected the seeded "sporty" trait');
	});

	void test('insert, update, and delete a product round-trips through Harper', async () => {
		const id = 'integ-test-1';

		// Insert
		await op(ctx, {
			operation: 'insert',
			database: 'data',
			table: 'Product',
			records: [
				{ id, name: 'Integration Test Widget', category: 'Testing', price: 9.99 },
			],
		});

		let read = (await op(ctx, {
			operation: 'search_by_id',
			database: 'data',
			table: 'Product',
			ids: [id],
			get_attributes: ['id', 'name', 'price'],
		})) as Array<{ id: string; name: string; price: number }>;
		strictEqual(read.length, 1, 'expected the inserted product to exist');
		strictEqual(read[0].name, 'Integration Test Widget');
		strictEqual(read[0].price, 9.99);

		// Update
		await op(ctx, {
			operation: 'update',
			database: 'data',
			table: 'Product',
			records: [{ id, price: 19.99 }],
		});

		read = (await op(ctx, {
			operation: 'search_by_id',
			database: 'data',
			table: 'Product',
			ids: [id],
			get_attributes: ['id', 'name', 'price'],
		})) as Array<{ id: string; name: string; price: number }>;
		strictEqual(read[0].price, 19.99, 'expected the updated price');

		// Delete
		await op(ctx, {
			operation: 'delete',
			database: 'data',
			table: 'Product',
			ids: [id],
		});

		read = (await op(ctx, {
			operation: 'search_by_id',
			database: 'data',
			table: 'Product',
			ids: [id],
			get_attributes: ['id'],
		})) as Array<unknown>;
		strictEqual(read.length, 0, 'expected the product to be deleted');
	});

	void test('appCache cache tables exist and CacheRules is seeded with the four rules', async () => {
		const rules = (await op(ctx, {
			operation: 'search_by_value',
			database: 'appCache',
			table: 'CacheRules',
			search_attribute: 'id',
			search_value: '*',
			get_attributes: ['id', 'priority', 'pathPatterns', 'groupCode', 'bypassCache'],
		})) as Array<{ id: string; priority: number; pathPatterns: string[]; groupCode?: string; bypassCache?: boolean }>;
		strictEqual(rules.length, 4, `expected exactly 4 seeded cache rules, got ${rules.length}`);
		const byId = new Map(rules.map((rule) => [rule.id, rule]));
		ok(byId.get('personalized')?.bypassCache === true, 'expected the personalized rule to bypass the cache');
		strictEqual(byId.get('pdp')?.groupCode, 'pdp');
		strictEqual(byId.get('listing')?.groupCode, 'listing');
		strictEqual(byId.get('home')?.groupCode, 'home');
		for (const rule of rules) {
			ok(Array.isArray(rule.pathPatterns) && rule.pathPatterns.length > 0, `expected pathPatterns on rule ${rule.id}`);
		}

		// CacheInvalidation exists and holds the probe's revalidateTag write.
		const invalidations = (await op(ctx, {
			operation: 'search_by_id',
			database: 'appCache',
			table: 'CacheInvalidation',
			ids: ['probe-tag'],
			get_attributes: ['id', 'timestamp'],
		})) as Array<{ id: string; timestamp: number }>;
		strictEqual(invalidations.length, 1, 'expected the probe-tag invalidation row');
		ok(typeof invalidations[0].timestamp === 'number', 'expected a numeric invalidation timestamp');
	});

	void test('cacheHandler.cjs round-trips a Blob-backed entry and honors bypass/invalidation', async () => {
		// resources.js exercised the real cache handler at boot and recorded the
		// outcome; see integrationTests/fixture/resources.js.
		const probes = (await op(ctx, {
			operation: 'search_by_id',
			database: 'data',
			table: 'CacheProbe',
			ids: ['cache-roundtrip'],
			get_attributes: ['id', 'ok', 'bypassRespected', 'invalidationMiss', 'singleRulesLoad', 'trimmedInvalidationMiss', 'detail'],
		})) as Array<{
			ok: boolean;
			bypassRespected: boolean;
			invalidationMiss: boolean;
			singleRulesLoad: boolean;
			trimmedInvalidationMiss: boolean;
			detail: string;
		}>;
		strictEqual(probes.length, 1, 'expected the cache probe record');
		const probe = probes[0];
		strictEqual(probe.ok, true, `expected get() to deserialize the Blob-backed set() payload (detail: ${probe.detail})`);
		strictEqual(probe.bypassRespected, true, `expected the bypassCache rule to prevent storage (detail: ${probe.detail})`);
		strictEqual(probe.invalidationMiss, true, `expected revalidateTag to soft-invalidate to a MISS (detail: ${probe.detail})`);
		strictEqual(probe.singleRulesLoad, true, `expected concurrent get() calls to share one CacheRules load (detail: ${probe.detail})`);
		strictEqual(probe.trimmedInvalidationMiss, true, `expected a padded tag to match its trimmed invalidation key (detail: ${probe.detail})`);

		// The invalidated entry is a soft MISS: the row itself is still present
		// with the serialized payload in the Blob column.
		const entries = (await op(ctx, {
			operation: 'search_by_id',
			database: 'appCache',
			table: 'Cache',
			ids: ['/products/cache-probe'],
			get_attributes: ['cacheKey', 'kind', 'groupCode', 'url', 'refreshedAt'],
		})) as Array<{ cacheKey: string; kind: string; groupCode: string; url: string; refreshedAt: number }>;
		strictEqual(entries.length, 1, 'expected the cache entry row to exist');
		strictEqual(entries[0].kind, 'APP_PAGE');
		strictEqual(entries[0].groupCode, 'pdp', 'expected the pdp rule groupCode on the stored entry');
		strictEqual(entries[0].url, '/products/cache-probe');
		ok(typeof entries[0].refreshedAt === 'number', 'expected a numeric refreshedAt');
	});
});
