/**
 * Unit tests for the cacheable SSR/ISR primary routes (issue #6).
 *
 * These run with Node's built-in test runner (node --test) and do not require
 * a running Harper instance. The route modules cannot be imported directly
 * here (they import 'harper' and JSX), so route-segment structure is verified
 * against the source files, while next.config.js is loaded and executed for
 * real to verify the Cache-Control headers() contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);
const ROOT = path.join(__dirname, '..');

function readSource(...segments) {
	return readFileSync(path.join(ROOT, ...segments), 'utf8');
}

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

test('home route is a server component with revalidate = 60 and no dynamic APIs', () => {
	const source = readSource('app', 'page.js');
	assert.ok(!source.includes("'use client'") && !source.includes('"use client"'), 'home must stay a server component');
	assert.match(source, /export const revalidate = 60;/, 'home must export revalidate = 60');
	// Dynamic APIs would force the route out of ISR into per-request rendering.
	assert.ok(!/\bcookies\(/.test(source), 'home must not call cookies()');
	assert.ok(!/\bheaders\(/.test(source), 'home must not call headers()');
	assert.ok(!source.includes('no-store'), 'home must not opt out of caching with no-store');
});

test('products listing is a server component that seeds the client browser with server data', () => {
	const page = readSource('app', 'products', 'page.js');
	assert.ok(!page.includes("'use client'") && !page.includes('"use client"'), 'listing page must be a server component');
	assert.match(page, /export const revalidate = 60;/, 'listing must export revalidate = 60');
	assert.ok(!page.includes('useEffect'), 'listing page must not fetch products client-side');
	assert.match(page, /listProducts/, 'listing page must fetch products on the server');
	assert.match(page, /initialProducts=\{products\}/, 'listing page must seed ProductsBrowser with server-fetched products');

	const browser = readSource('app', 'products', 'products-browser.js');
	assert.match(browser, /^'use client';/, 'products-browser must be a client component');
	assert.match(browser, /initialProducts/, 'products-browser must accept initialProducts');
	assert.ok(!browser.includes('useEffect'), 'products-browser must not refetch products on mount');
	assert.ok(!browser.includes('listProducts'), 'products-browser must render only server-provided products');
	// Interactive filtering/sorting stays client-side.
	assert.match(browser, /setCategory/, 'category filter must remain interactive');
	assert.match(browser, /setPriceRange/, 'price filter must remain interactive');
	assert.match(browser, /setSortBy/, 'sorting must remain interactive');
});

test('product detail route uses on-demand ISR with a server-side 404 guard', () => {
	const source = readSource('app', 'products', '[id]', 'page.js');
	assert.ok(!source.includes('generateStaticParams'), 'PDP must not prerender all products at build time');
	assert.match(source, /export const revalidate = 60;/, 'PDP must export revalidate = 60');
	assert.match(source, /export const dynamicParams = true;/, 'PDP must render unknown ids on demand');
	assert.match(source, /if \(!product\) notFound\(\);/, 'PDP must 404 on the server for missing products');
});
