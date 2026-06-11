/**
 * Unit tests for the helper modules used by the cacheable SSR/ISR routes (issue #6).
 *
 * These run with Node's built-in test runner (node --test) and do not require
 * a running Harper instance. They test next.config.js headers, the product
 * validation predicate (validate-product.mjs), and the filter/sort logic
 * (filter-products.mjs). The route segment configs (revalidate, dynamicParams)
 * live in each page.js and are verified by `next build` and the integration
 * test suite (integrationTests/app.test.ts).
 *
 * Cache MISS/HIT behavior and CacheInvalidation semantics are verified in the
 * Harper data-layer suite (integrationTests/app.test.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);
const ROOT = path.join(__dirname, '..');

const EXPECTED_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=600';

test('next.config.js headers() sets the exact Cache-Control on /, /products, and /products/:id', async () => {
	const config = _require(path.join(ROOT, 'next.config.js'));
	assert.equal(typeof config.headers, 'function', 'expected nextConfig to define headers()');
	const headers = await config.headers();

	for (const source of ['/', '/products', '/products/:id']) {
		const entry = headers.find((header) => header.source === source);
		assert.ok(entry, `expected a headers() entry for ${source}`);
		const cacheControl = entry.headers.find((header) => header.key === 'Cache-Control');
		assert.ok(cacheControl, `expected a Cache-Control header for ${source}`);
		assert.equal(cacheControl.value, EXPECTED_CACHE_CONTROL, `unexpected Cache-Control for ${source}`);
	}
});

test('product detail validation guard rejects missing and malformed records', async () => {
	const { isValidProduct } = await import(
		pathToFileURL(path.join(ROOT, 'app', 'products', '[id]', 'validate-product.mjs')).href
	);

	const validProduct = {
		name: 'Trail Runner X',
		price: 129.99,
		description: 'Lightweight trail running shoe',
		image: '/images/trail-runner-x.jpg',
		category: 'footwear',
		features: ['breathable mesh', 'rock plate'],
		specs: { weight: '280g', drop: '6mm' },
	};

	assert.equal(isValidProduct(null), false, 'null (unknown id) must be rejected');
	assert.equal(isValidProduct({}), false, 'empty object must be rejected');
	const { name: _name, ...withoutName } = validProduct;
	assert.equal(isValidProduct(withoutName), false, 'missing name must be rejected');
	const { features: _features, ...withoutFeatures } = validProduct;
	assert.equal(isValidProduct(withoutFeatures), false, 'missing features must be rejected');
	assert.equal(
		isValidProduct({ ...validProduct, features: 'not-an-array' }),
		false,
		'non-array features must be rejected (ProductPage calls features.map)'
	);
	const { specs: _specs, ...withoutSpecs } = validProduct;
	assert.equal(isValidProduct(withoutSpecs), false, 'missing specs must be rejected');
	assert.equal(
		isValidProduct({ ...validProduct, specs: 'not-an-object' }),
		false,
		'non-object specs must be rejected (ProductPage calls Object.entries(specs))'
	);
	const { price: _price, ...withoutPrice } = validProduct;
	assert.equal(isValidProduct(withoutPrice), false, 'missing price must be rejected');
	assert.equal(
		isValidProduct({ ...validProduct, price: 'free' }),
		false,
		'non-numeric price must be rejected'
	);
	assert.equal(isValidProduct({ ...validProduct, price: -1 }), false, 'negative price must be rejected');
	assert.equal(
		isValidProduct({ ...validProduct, specs: [] }),
		false,
		'array specs must be rejected (Object.entries on an array yields numeric string keys)'
	);
	assert.equal(isValidProduct({ ...validProduct, specs: null }), false, 'null specs must be rejected');

	const { image: _image, ...withoutImage } = validProduct;
	assert.equal(isValidProduct(withoutImage), false, 'missing image must be rejected');
	assert.equal(isValidProduct({ ...validProduct, image: '' }), false, 'empty image must be rejected');
	const { description: _desc, ...withoutDescription } = validProduct;
	assert.equal(isValidProduct(withoutDescription), false, 'missing description must be rejected');
	assert.equal(isValidProduct({ ...validProduct, description: '' }), false, 'empty description must be rejected');
	const { category: _cat, ...withoutCategory } = validProduct;
	assert.equal(isValidProduct(withoutCategory), false, 'missing category must be rejected');
	assert.equal(isValidProduct({ ...validProduct, category: '' }), false, 'empty category must be rejected');
	assert.equal(isValidProduct(validProduct), true, 'a well-formed product record must be accepted');
	assert.equal(isValidProduct({ ...validProduct, price: 0 }), true, 'price of 0 is a valid price');
});

test('products listing filter/sort logic filters by category, price range, and sort order', async () => {
	const { filterProducts } = await import(
		pathToFileURL(path.join(ROOT, 'app', 'products', 'filter-products.mjs')).href
	);

	const products = [
		{ id: 'a', name: 'Headphones', category: 'Electronics', price: 200 },
		{ id: 'b', name: 'Cable', category: 'Accessories', price: 15 },
		{ id: 'c', name: 'Speaker', category: 'Electronics', price: 90 },
		{ id: 'd', name: 'Case', category: 'Accessories', price: 40 },
	];

	const all = filterProducts(products, { category: 'all', priceRange: [0, 300], sortBy: 'featured' });
	assert.deepEqual(
		all.map((product) => product.id),
		['a', 'b', 'c', 'd'],
		'featured sort must preserve the original order'
	);
	assert.notEqual(all, products, 'filterProducts must return a new array, not mutate the input');

	const electronics = filterProducts(products, { category: 'Electronics', priceRange: [0, 300], sortBy: 'featured' });
	assert.deepEqual(
		electronics.map((product) => product.id),
		['a', 'c'],
		'category filter must keep only matching products'
	);

	const midRange = filterProducts(products, { category: 'all', priceRange: [20, 100], sortBy: 'featured' });
	assert.deepEqual(
		midRange.map((product) => product.id),
		['c', 'd'],
		'price range filter must be inclusive of bounds and exclude products outside the range'
	);

	const ascending = filterProducts(products, { category: 'all', priceRange: [0, 300], sortBy: 'price-asc' });
	assert.deepEqual(
		ascending.map((product) => product.price),
		[15, 40, 90, 200],
		'price-asc must sort cheapest first'
	);

	const descending = filterProducts(products, { category: 'all', priceRange: [0, 300], sortBy: 'price-desc' });
	assert.deepEqual(
		descending.map((product) => product.price),
		[200, 90, 40, 15],
		'price-desc must sort most expensive first'
	);

	const none = filterProducts(products, { category: 'Electronics', priceRange: [0, 10], sortBy: 'featured' });
	assert.deepEqual(none, [], 'no matches must yield an empty array');
});

// --- Early Hints origin contract (issue #8) ---

test('next.config.js keeps images unoptimized and never emits Link or Server-Timing from headers()', async () => {
	const config = _require(path.join(ROOT, 'next.config.js'));
	assert.equal(config.images?.unoptimized, true, 'images.unoptimized must stay true so LCP image URLs are never rewritten through /_next/image');

	const headers = await config.headers();
	for (const entry of headers) {
		for (const header of entry.headers) {
			assert.ok(
				!/^(link|server-timing)$/i.test(header.key),
				`headers() must not set or overwrite ${header.key} for ${entry.source}; upstream owns Link/103 and the server-timing component appends Server-Timing`
			);
		}
	}
});

test('each measured route marks a single, stable LCP image as high priority', () => {
	const homeSource = readFileSync(path.join(ROOT, 'app', 'page.js'), 'utf8');
	const heroMatch = homeSource.match(/src="(https:\/\/images\.unsplash\.com\/[^"]+)"/);
	assert.ok(heroMatch, 'expected the home hero to use a fixed images.unsplash.com src');
	assert.ok(homeSource.includes('priority'), 'expected the home hero next/image to keep the priority attribute');

	const browserSource = readFileSync(path.join(ROOT, 'app', 'products', 'products-browser.js'), 'utf8');
	assert.ok(
		browserSource.includes(`fetchPriority={index === 0 ? "high" : undefined}`),
		'expected only the first /products card image to be marked fetchpriority=high (single LCP candidate, canonical src untouched)'
	);

	const productPageSource = readFileSync(path.join(ROOT, 'app', 'products', '[id]', 'product-page.js'), 'utf8');
	assert.ok(
		productPageSource.includes('fetchPriority="high"'),
		'expected the main product image on /products/[id] (and /personalized) to be marked fetchpriority=high'
	);
	assert.ok(
		!/relatedProduct[\s\S]*?priority/.test(productPageSource.slice(productPageSource.indexOf('Related Products'))),
		'related-product images must not be prioritized (no second competing LCP image)'
	);
});

test('docs/early-hints-manifest.md lists the preconnect host and exact LCP URLs for all four routes', async () => {
	const manifest = readFileSync(path.join(ROOT, 'docs', 'early-hints-manifest.md'), 'utf8');

	for (const route of ['## /\n', '## /products\n', '## /products/[id]\n', '## /products/[id]/personalized\n']) {
		assert.ok(manifest.includes(route), `expected a manifest section for ${route.trim()}`);
	}
	assert.ok(
		manifest.includes('**Preconnect host (all routes):** `https://images.unsplash.com`'),
		'expected the shared preconnect host'
	);

	// The hero preload URL must match the actual src rendered by app/page.js.
	const homeSource = readFileSync(path.join(ROOT, 'app', 'page.js'), 'utf8');
	const heroUrl = homeSource.match(/src="(https:\/\/images\.unsplash\.com\/[^"]+)"/)[1];
	assert.ok(manifest.includes(heroUrl), `expected the manifest to list the exact hero image URL ${heroUrl}`);

	// The /products preload URL must match the first card the listing renders:
	// seed order through the real filterProducts() with the default controls.
	const { filterProducts } = await import(
		pathToFileURL(path.join(ROOT, 'app', 'products', 'filter-products.mjs')).href
	);
	const seedProducts = _require(path.join(ROOT, 'productdata.json'));
	const firstCard = filterProducts(seedProducts, { category: 'all', priceRange: [0, 300], sortBy: 'featured' })[0];
	assert.ok(
		manifest.includes(firstCard.image),
		`expected the manifest to list the first product-card image URL ${firstCard.image}`
	);

	// Chunk filenames are fingerprinted per build; the manifest must say to
	// refresh them from the built document head instead of hard-coding them.
	assert.ok(
		/change on every build/.test(manifest) && /document `<head>`/.test(manifest),
		'expected guidance that CSS/JS chunk paths are per-build and must be read from the built document head'
	);
});
