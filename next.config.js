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
	// (issue #6) and the never-cache personalized route (issue #7).
	async headers() {
		const isr = { key: 'Cache-Control', value: 'public, max-age=60, stale-while-revalidate=600' };
		return [
			{ source: '/', headers: [isr] },
			{ source: '/products', headers: [isr] },
			{ source: '/products/:id', headers: [isr] },
			{ source: '/products/:id/personalized', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
		];
	},
};

module.exports = withHarper(nextConfig);
