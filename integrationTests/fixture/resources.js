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

import { tables, databases, Resource } from 'harper';
import productdata from './productdata.json' with { type: 'json' };
// The REAL lib/server-timing.mjs, copied in by app.test.ts (the copy is
// gitignored) because Harper restricts a component to files inside its own
// directory.
import { recordDecisionDuration } from './server-timing-lib.mjs';

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
const probe = {
	id: 'cache-roundtrip',
	ok: false,
	bypassRespected: false,
	invalidationMiss: false,
	singleRulesLoad: false,
	trimmedInvalidationMiss: false,
	detail: '',
};
try {
	const CacheHandler = (await import('./cacheHandler.cjs')).default;
	const handler = new CacheHandler({});
	const cacheKey = '/products/cache-probe';
	const value = { kind: 'APP_PAGE', html: '<html>cache-probe</html>', rscData: 'r'.repeat(64) };

	// Stampede check (must run before anything else touches the handler so the
	// module-level rules cache is still empty): N concurrent get() calls must
	// share ONE in-flight CacheRules load, not issue one scan each.
	const realSearch = databases.appCache.CacheRules.search.bind(databases.appCache.CacheRules);
	let rulesSearchCount = 0;
	databases.appCache.CacheRules.search = (...args) => {
		rulesSearchCount += 1;
		return realSearch(...args);
	};
	try {
		await Promise.all([
			handler.get('/products/stampede-check', {}),
			handler.get('/products/stampede-check', {}),
			handler.get('/products/stampede-check', {}),
		]);
	} finally {
		delete databases.appCache.CacheRules.search;
	}
	probe.singleRulesLoad = rulesSearchCount === 1;
	if (!probe.singleRulesLoad) probe.detail += `rulesSearchCount=${rulesSearchCount};`;

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

	// Whitespace-trim check: a tag stored with padding (" padded-tag ") must
	// still be invalidated by the clean key "padded-tag".
	const trimKey = '/products/cache-probe-trim';
	await handler.set(trimKey, value, { tags: [' padded-tag '] });
	const beforeTrimInvalidation = await handler.get(trimKey, {});
	await handler.revalidateTag('padded-tag');
	const afterTrimInvalidation = await handler.get(trimKey, {});
	probe.trimmedInvalidationMiss = beforeTrimInvalidation != null && afterTrimInvalidation == null;

	const allPassed =
		probe.ok &&
		probe.bypassRespected &&
		probe.invalidationMiss &&
		probe.singleRulesLoad &&
		probe.trimmedInvalidationMiss;
	probe.detail = allPassed ? 'ok' : `assertion failed;${probe.detail}`;
} catch (error) {
	probe.detail = `threw: ${error?.message ?? error}`;
}
tables.CacheProbe.put(probe);

// Fixture-only HTTP endpoint for the server-timing middleware (issue #7):
// records a fixed decision duration through the REAL lib/server-timing.mjs
// accessor while handling a live REST request, so app.test.ts can assert the
// server-timing extension appends `decision;dur` to the Server-Timing header
// without stripping Harper core's own segments.
export class ServerTimingProbe extends Resource {
	get() {
		recordDecisionDuration(42);
		return { ok: true };
	}
}
