'use server';
import { tables } from 'harper';
const { Product } = tables;
import { initOpenai } from '@/lib/utils';
import { embed, EMBEDDINGS_ENABLED } from '@/lib/embeddings';

// Harper DB Server Actions
export async function listProducts(conditions = {}) {
	const products = [];
	const results = Product.search(conditions);
	for await (const product of results) {
		products.push(product);
	}
	return JSON.stringify(products);
}

export async function getProduct(id) {
	return tables.Product.get(id);
}

export async function getUserTraits(id = "1") {
	return tables.Traits.get(id).traits;
}

export async function updateUserTraits(id = "1", traits) {
	await tables.Traits.put({ id, traits });
	return 'successfully updated Traits table';
}

// Search Server Action (Harper-native)
//
// Semantic search when an embedding provider is configured: embed the query and
// run an HNSW nearest-neighbor search over the products, ranked by similarity.
// Falls back to a Harper keyword match otherwise, so search works with no keys
// and no external search service.
export async function searchProducts(searchTerm = '') {
	const term = searchTerm.trim();
	if (!term) return [];

	const query = EMBEDDINGS_ENABLED
		? {
				select: ['id', 'name', 'category', 'price', 'image', 'description', '$distance'],
				sort: { attribute: 'embedding', target: await embed(term) },
				limit: 8,
			}
		: {
				conditions: [{ attribute: 'name', comparator: 'contains', value: term }],
				limit: 8,
			};

	const results = [];
	for await (const product of Product.search(query)) {
		results.push(product);
	}
	return results;
}

// OpenAI Server Actions
const openaiClient = initOpenai();
export async function customizeProductDescription(userTraits = [], productDescription) {
	if (openaiClient) {
		const prompt = `Given that a person has the following traits: ${userTraits.join(', ')} 
			can you rewrite the following product description passage for someone like this: ${productDescription} without using exclamation points?
			Only return the product description, no other text.
			Keep the description to a 300 character length maximum.
		`;
		const response = await openaiClient.chat.completions.create({
			messages: [{ role: 'user', content: prompt }],
			model: 'gpt-4o-mini',
		});
		return response.choices[0].message.content;
	}
	return null;
}
