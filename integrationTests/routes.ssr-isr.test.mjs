/**
 * Unit tests for the cacheable SSR/ISR primary routes (issue #6).
 *
 * These run with Node's built-in test runner (node --test) and do not require
 * a running Harper instance. The route page modules cannot be imported here
 * (they contain JSX and import 'harper'), so each route's segment config
 * (revalidate, dynamicParams) lives in a co-located plain route-config.mjs
 * module that the page re-exports. These tests import those production
 * modules and execute next.config.js for real, so they fail if the production
 * values change or are removed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);
const ROOT = path.join(__dirname, '..');

function importRouteConfig(...segments) {
	return import(pathToFileURL(path.join(ROOT, 'app', ...segments, 'route-config.mjs')).href);
}

const EXPECTED_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=600';
const EXPECTED_REVALIDATE = 60;

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

test('home route exports revalidate = 60 for ISR', async () => {
	const config = await importRouteConfig();
	assert.equal(config.revalidate, EXPECTED_REVALIDATE, 'home must revalidate every 60 seconds');
});

test('products listing route exports revalidate = 60 for ISR', async () => {
	const config = await importRouteConfig('products');
	assert.equal(config.revalidate, EXPECTED_REVALIDATE, 'listing must revalidate every 60 seconds');
});

test('product detail route exports revalidate = 60 and dynamicParams = true for on-demand ISR', async () => {
	const config = await importRouteConfig('products', '[id]');
	assert.equal(config.revalidate, EXPECTED_REVALIDATE, 'PDP must revalidate every 60 seconds');
	assert.equal(config.dynamicParams, true, 'PDP must render unknown ids on demand');
	assert.ok(!('generateStaticParams' in config), 'PDP config must not reintroduce build-time prerendering');
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

	assert.equal(isValidProduct(validProduct), true, 'a well-formed product record must be accepted');
	assert.equal(isValidProduct({ ...validProduct, price: 0 }), true, 'price of 0 is a valid price');
});

test('product detail page.js uses the shared validation predicate', async () => {
	const { readFileSync } = await import('node:fs');
	const source = readFileSync(path.join(ROOT, 'app', 'products', '[id]', 'page.js'), 'utf8');
	assert.match(
		source,
		/import\s*\{\s*isValidProduct\s*\}\s*from\s*'\.\/validate-product\.mjs'/,
		'page.js must import isValidProduct from validate-product.mjs'
	);
	assert.match(
		source,
		/if\s*\(\s*!isValidProduct\(product\)\s*\)\s*\{\s*\n\s*notFound\(\);/,
		'page.js must call notFound() when isValidProduct(product) is false'
	);
});
