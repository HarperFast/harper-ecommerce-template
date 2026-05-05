import { withHarper } from '@harperfast/nextjs';

const nextConfig = {
	reactStrictMode: false,
	eslint: { ignoreDuringBuilds: true, },
	images: { unoptimized: true },
	webpack: (config) => {
		config.externals.push({
			harperdb: 'commonjs harperdb',
		});
		return config;
	},
};

module.exports = withHarper(nextConfig);
