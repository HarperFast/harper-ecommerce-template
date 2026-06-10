const path = require('path');
const { withHarper } = require('@harperfast/nextjs');

const CACHE_HANDLER_PATH = path.join(__dirname, 'cacheHandler.cjs');

const nextConfig = {
	reactStrictMode: false,
	eslint: { ignoreDuringBuilds: true },
	images: { unoptimized: true },
	cacheHandler: CACHE_HANDLER_PATH,
	cacheMaxMemorySize: 0,
	async headers() {
		return [
			{
				// Personalized PDP renders per-request (force-dynamic) and must
				// never be cached by browsers or intermediaries; the matching
				// `personalized` CacheRule in resources.js keeps it out of the
				// Harper-backed incremental cache.
				source: '/products/:id/personalized',
				headers: [{ key: 'Cache-Control', value: 'no-store' }],
			},
		];
	},
};

module.exports = withHarper(nextConfig);
