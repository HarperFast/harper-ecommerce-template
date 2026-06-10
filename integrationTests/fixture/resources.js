/***************************************************
 * BOOTSTRAP (integration-test fixture)
 *
 * Mirrors the repo-root resources.js seed logic exactly. Kept as a separate
 * file because the integration-testing harness copies a single component
 * directory and Harper restricts a component from reading files outside its
 * own directory (allowedDirectory: app). This exercises the v5 migration
 * surface: `import { tables } from 'harper'` + seeding the @table @export
 * tables.
 ***************************************************/

import { tables, databases } from 'harper';
import productdata from './productdata.json' with { type: 'json' };

// product table seed data
for (const product of productdata) {
	tables.Product.put(product);
}

// trait table seed data
// Typically this data would come from a tool like Segment, Optimizely, etc
const USER_TRAITS = ['sporty', 'likes computers', 'lives near a ski resort'];
tables.Traits.put({ id: '1', traits: USER_TRAITS });

// Next.js incremental-cache rules — mirrors the repo-root resources.js seed.
const CACHE_RULES = [
	{ id: 'personalized', description: 'Personalized PDP — never cache', priority: 10, pathPatterns: ['^/products/[^/]+/personalized$'], bypassCache: true },
	{ id: 'pdp', description: 'Product detail', priority: 20, pathPatterns: ['^/products/[^/]+$'], groupCode: 'pdp' },
	{ id: 'listing', description: 'Products listing', priority: 30, pathPatterns: ['^/products$'], groupCode: 'listing' },
	{ id: 'home', description: 'Home', priority: 40, pathPatterns: ['^/$'], groupCode: 'home' },
];
for (const rule of CACHE_RULES) {
	databases.appCache.CacheRules.put(rule);
}

// Exercise the REAL repo-root cacheHandler.cjs (app.test.ts copies it into
// this fixture before boot) against live Harper tables: rule matching, a
// Blob! write via set(), the FileBackedBlob -> bytes -> v8.deserialize read
// path via get(), bypass rules, and soft invalidation. The outcome lands in
// the fixture-only CacheProbe table so the test can assert it over the
// Operations API without booting the Next.js plugin.
const probe = { id: 'cache-roundtrip', ok: false, bypassRespected: false, invalidationMiss: false, detail: '' };
try {
	const CacheHandler = (await import('./cacheHandler.cjs')).default;
	const handler = new CacheHandler({});
	const cacheKey = '/products/cache-probe';
	const value = { kind: 'APP_PAGE', html: '<html>cache-probe</html>', rscData: 'r'.repeat(64) };

	// Blob round-trip through the real Cache table.
	await handler.set(cacheKey, value, { tags: ['probe-tag'] });
	const entry = await handler.get(cacheKey, {});
	probe.ok =
		entry != null &&
		typeof entry.lastModified === 'number' &&
		entry.value?.html === value.html &&
		entry.value?.rscData === value.rscData;

	// bypassCache rule: set() on the personalized path must not store a row.
	await handler.set('/products/cache-probe/personalized', value, {});
	const bypassed = await databases.appCache.Cache.get('/products/cache-probe/personalized');
	probe.bypassRespected = bypassed == null;

	// Soft invalidation: revalidateTag turns the stored entry into a MISS.
	await handler.revalidateTag('probe-tag');
	const afterInvalidation = await handler.get(cacheKey, {});
	probe.invalidationMiss = afterInvalidation == null;

	probe.detail = probe.ok && probe.bypassRespected && probe.invalidationMiss ? 'ok' : 'assertion failed';
} catch (error) {
	probe.detail = `threw: ${error?.message ?? error}`;
}
tables.CacheProbe.put(probe);
