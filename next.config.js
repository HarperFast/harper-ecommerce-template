const path = require('path');
const { withHarper } = require('@harperfast/nextjs');

const CACHE_HANDLER_PATH = path.join(__dirname, 'cacheHandler.cjs');

const nextConfig = {
	reactStrictMode: false,
	eslint: { ignoreDuringBuilds: true },
	images: { unoptimized: true },
	cacheHandler: CACHE_HANDLER_PATH,
};

module.exports = withHarper(nextConfig);
