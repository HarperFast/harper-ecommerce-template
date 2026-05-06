'use server';
import { tables } from 'harper';
const { Product } = tables;
import { initAlgolia, initOpenai } from '@/lib/utils';

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

// Algolia Search Server Actions
const algoliaClient = initAlgolia();
export async function searchProducts(searchTerm = '') {
	if (algoliaClient) {
		return await algoliaClient.searchSingleIndex({
			indexName: 'productdata',
			searchParams: { query: searchTerm },
		});
	}
	// TODO: return harperdb graphql query
	return [];
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
