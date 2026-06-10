/***************************************************
 * BOOTSTRAP (integration-test fixture)
 *
 * Mirrors the repo-root resources.js seed logic exactly. Kept as a separate
 * file because the integration-testing harness copies a single component
 * directory and Harper restricts a component from reading files outside its
 * own directory (allowedDirectory: app). This exercises the v5 migration
 * surface: `import { tables } from 'harper'` + seeding the @table @export
 * tables.
 ***************************************************/

import { tables } from 'harper';
import productdata from './productdata.json' with { type: 'json' };

// product table seed data
for (const product of productdata) {
	tables.Product.put(product);
}

// trait table seed data
// Typically this data would come from a tool like Segment, Optimizely, etc
const USER_TRAITS = ['sporty', 'likes computers', 'lives near a ski resort'];
tables.Traits.put({ id: '1', traits: USER_TRAITS });
