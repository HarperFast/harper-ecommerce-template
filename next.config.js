const path = require('path');
const { withHarper } = require('@harperfast/nextjs');

const CACHE_HANDLER_PATH = path.join(__dirname, 'cacheHandler.cjs');

const nextConfig = {
	reactStrictMode: false,
	eslint: { ignoreDuringBuilds: true },
	// Early Hints origin contract (issue #8): keep image URLs stable and
	// un-rewritten (no /_next/image?... rewrites) so each route's LCP image URL
	// is predictable for upstream `103` hints. The app must not emit `103`
	// itself and headers() must never set or overwrite `Link` or
	// `Server-Timing` — only Cache-Control. See docs/early-hints-manifest.md.
	images: { unoptimized: true },
	outputFileTracingRoot: __dirname,
	cacheHandler: CACHE_HANDLER_PATH,
	cacheMaxMemorySize: 0,
	// Build workers each load the (externalized) harper module, and concurrent
	// processes contend for the same database lock. One worker serializes
	// page-data collection and static generation so `next build` works against
	// a local Harper root.
	experimental: { cpus: 1 },
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
