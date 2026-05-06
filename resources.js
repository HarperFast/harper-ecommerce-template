/***************************************************
 * BOOTSTRAP
 ***************************************************/

import { tables } from 'harper';
import productdata from "./productdata.json" with { type: "json" };

// product table seed data
for (const product of productdata) {
	tables.Product.put(product);
}

// trait table seed data
// Typically this data would come from a tool like Segment, Optimizely, etc
const USER_TRAITS = ['sporty', 'likes computers', 'lives near a ski resort'];
tables.Traits.put({ id: "1", traits: USER_TRAITS});
