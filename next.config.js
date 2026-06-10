const path = require('node:path');
const { withHarper } = require('@harperfast/nextjs');

const nextConfig = {
	reactStrictMode: false,
	images: { unoptimized: true },
	outputFileTracingRoot: __dirname,
	// Incremental Cache lives in Harper (see cacheHandler.cjs); disable the
	// default in-memory LRU so every worker reads the same Harper-backed cache.
	cacheHandler: path.join(__dirname, 'cacheHandler.cjs'),
	cacheMaxMemorySize: 0,
	// Build workers each load the (externalized) harper module, and concurrent
	// processes contend for the same database lock. One worker serializes
	// page-data collection and static generation so `next build` works against
	// a local Harper root.
	experimental: { cpus: 1 },
};

module.exports = withHarper(nextConfig);
