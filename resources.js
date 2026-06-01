/***************************************************
 * BOOTSTRAP
 ***************************************************/

import { tables } from 'harper';
import productdata from "./productdata.json" with { type: "json" };
import { embed, EMBEDDINGS_ENABLED } from './lib/embeddings.js';

// product table seed data
for (const product of productdata) {
	// When an embedding provider is configured, embed each product so it can be
	// found by meaning via Harper's HNSW vector index. Skipped otherwise.
	if (EMBEDDINGS_ENABLED) {
		product.embedding = await embed(`${product.name}. ${product.description}`);
	}
	tables.Product.put(product);
}

// trait table seed data
// Typically this data would come from a tool like Segment, Optimizely, etc
const USER_TRAITS = ['sporty', 'likes computers', 'lives near a ski resort'];
tables.Traits.put({ id: "1", traits: USER_TRAITS});
