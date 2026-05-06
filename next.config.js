const { withHarper } = require('@harperfast/nextjs');

const nextConfig = {
	reactStrictMode: false,
	eslint: { ignoreDuringBuilds: true, },
	images: { unoptimized: true },
};

module.exports = withHarper(nextConfig);
