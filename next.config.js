const withHarper = require('@harperfast/nextjs');

const nextConfig = {
	reactStrictMode: false,
	eslint: { ignoreDuringBuilds: true, },
	images: { unoptimized: true },
	webpack: (config) => {
		config.externals.push({
			harper: 'commonjs harper',
		});
		return config;
	},
};

module.exports = withHarper(nextConfig);
