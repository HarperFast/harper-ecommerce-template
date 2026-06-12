/***************************************************
 * BOOTSTRAP
 ***************************************************/

import { tables, databases } from 'harper';
import productdata from "./productdata.json" with { type: "json" };
import { embed, EMBEDDINGS_ENABLED } from './lib/embeddings.js';

// product table seed data
if (EMBEDDINGS_ENABLED) {
	await Promise.all(
		productdata.map(async (product) => {
			product.embedding = await embed(`${product.name}. ${product.description}`);
		})
	);
}
for (const product of productdata) {
	tables.Product.put(product);
}

// trait table seed data
// Typically this data would come from a tool like Segment, Optimizely, etc
const USER_TRAITS = ['sporty', 'likes computers', 'lives near a ski resort'];
tables.Traits.put({ id: "1", traits: USER_TRAITS});

// Next.js incremental-cache rules, read by cacheHandler.cjs. Lowest priority
// value wins; put() is keyed by id, so re-seeding on restart is idempotent.
const CACHE_RULES = [
	{ id: 'personalized', description: 'Personalized PDP — never cache', priority: 10, pathPatterns: ['^/products/[^/]+/personalized$'], bypassCache: true },
	{ id: 'pdp', description: 'Product detail', priority: 20, pathPatterns: ['^/products/[^/]+$'], groupCode: 'pdp' },
	{ id: 'listing', description: 'Products listing', priority: 30, pathPatterns: ['^/products$'], groupCode: 'listing' },
	{ id: 'home', description: 'Home', priority: 40, pathPatterns: ['^/$'], groupCode: 'home' },
];
await Promise.all(CACHE_RULES.map((rule) => databases.appCache.CacheRules.put(rule)));
