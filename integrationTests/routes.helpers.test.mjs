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
 * TODO: extend integrationTests/app.test.ts to verify Cache-Control headers,
 * server-rendered HTML content, and ISR cache MISS/HIT behavior for /, /products,
 * and /products/[id] once the Harper test environment supports live HTTP assertions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
