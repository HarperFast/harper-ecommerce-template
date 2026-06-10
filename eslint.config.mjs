import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import harperESLint from '@harperdb/code-guidelines/eslint';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Next.js 16 removed the `next lint` command; this is the standard ESLint CLI
// replacement config (see the next-lint-to-eslint-cli migration).
export default defineConfig([
	// Includes base JS, TS, and prettier configs
	...harperESLint,

	...nextCoreWebVitals,
	...nextTypescript,
	{
		// The cache handler and next.config.js are intentionally CommonJS
		// (Next.js loads cacheHandler via require at runtime).
		files: ['**/*.cjs', 'next.config.js'],
		rules: { '@typescript-eslint/no-require-imports': 'off' },
	},
	{
		// Vendored shadcn/ui primitives; keep them as generated.
		files: ['components/ui/**'],
		rules: { '@typescript-eslint/no-empty-object-type': 'off' },
	},
	globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'node_modules/**']),
]);
