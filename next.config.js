const path = require('path');
const { withHarper } = require('@harperfast/nextjs');

const CACHE_HANDLER_PATH = path.join(__dirname, 'cacheHandler.cjs');

const nextConfig = {
	reactStrictMode: false,
	eslint: { ignoreDuringBuilds: true },
	images: { unoptimized: true },
	cacheHandler: CACHE_HANDLER_PATH,
	cacheMaxMemorySize: 0,
	// Deterministic per-route Cache-Control for the cacheable SSR/ISR routes
	// (issue #6). Values align with the routes' `revalidate = 60`.
	async headers() {
		const cacheControl = { key: 'Cache-Control', value: 'public, max-age=60, stale-while-revalidate=600' };
		return [
			{ source: '/', headers: [cacheControl] },
			{ source: '/products', headers: [cacheControl] },
			{ source: '/products/:id', headers: [cacheControl] },
		];
	},
};

module.exports = withHarper(nextConfig);
