'use server';
// Access Harper's tables through the runtime global rather than a static
// module-level import. A static `import { tables } from 'harper'` fires when
// the module is first loaded — including in Next.js build workers that evaluate
// pages to collect route-segment config. Those workers are separate processes
// where the parent Harper process already holds an exclusive RocksDB lock on
// appCache, so the open fails. globalThis.tables is populated by Harper at
// startup and is available by the time any server action is called.
import { initOpenai } from '@/lib/utils';
import { embed, EMBEDDINGS_ENABLED } from '@/lib/embeddings';

// Harper DB Server Actions
export async function listProducts(conditions = {}) {
	if (!globalThis.tables) return JSON.stringify([]);
	const products = [];
	const results = globalThis.tables.Product.search(conditions);
	for await (const product of results) {
		products.push(product);
	}
	return JSON.stringify(products);
}

export async function getProduct(id) {
	return globalThis.tables?.Product.get(id) ?? null;
}

export async function getUserTraits(id = "1") {
	const record = await globalThis.tables?.Traits.get(id);
	return record?.traits ? [...record.traits] : [];
}

export async function updateUserTraits(id = "1", traits) {
	if (!globalThis.tables) return;
	await globalThis.tables.Traits.put({ id, traits });
	return 'successfully updated Traits table';
}

// Search Server Action (Harper-native)
//
// Semantic search when an embedding provider is configured: embed the query and
// run an HNSW nearest-neighbor search over the products, ranked by similarity.
// Falls back to a Harper keyword match otherwise, so search works with no keys
// and no external search service.
export async function searchProducts(searchTerm = '') {
	if (!globalThis.tables) return [];
	const term = searchTerm.trim();
	if (!term) return [];

	let query;
	if (EMBEDDINGS_ENABLED) {
		try {
			const embedding = await embed(term);
			if (embedding) {
				query = {
					select: ['id', 'name', 'category', 'price', 'image', 'description', '$distance'],
					sort: { attribute: 'embedding', target: embedding },
					limit: 8,
				};
			}
		} catch (error) {
			console.error('Embedding failed, falling back to keyword search:', error);
		}
	}
	if (!query) {
		query = {
			conditions: [{ attribute: 'name', comparator: 'contains', value: term }],
			limit: 8,
		};
	}

	const results = [];
	for await (const product of globalThis.tables.Product.search(query)) {
		results.push(product);
	}
	return results;
}

// OpenAI Server Actions
export async function customizeProductDescription(userTraits = [], productDescription) {
	const openaiClient = initOpenai();
	if (openaiClient) {
		const prompt = `Given that a person has the following traits: ${userTraits.join(', ')} 
			can you rewrite the following product description passage for someone like this: ${productDescription} without using exclamation points?
			Only return the product description, no other text.
			Keep the description to a 300 character length maximum.
		`;
		const response = await openaiClient.chat.completions.create({
			messages: [{ role: 'user', content: prompt }],
			model: 'gpt-4o-mini',
			// The prompt asks for <= 300 characters (~75 tokens); cap the
			// completion so a runaway response cannot inflate think-time.
			max_tokens: 150,
		});
		return response.choices[0].message.content;
	}
	return null;
}
