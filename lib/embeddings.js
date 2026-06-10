import OpenAI from 'openai';

// Embeddings for semantic product search. Generated via OpenAI when
// OPENAI_API_KEY is set; Harper stores and searches the vectors with its
// built-in HNSW index, so the search engine itself is Harper, not an external
// service. Built-in Fabric embeddings are coming
// (https://github.com/HarperFast/harper/issues/510), which will move even this
// step in-process.
const MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

export const EMBEDDINGS_ENABLED = Boolean(process.env.OPENAI_API_KEY);

let client;
export async function embed(text) {
	if (!EMBEDDINGS_ENABLED) return null;
	client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
	const response = await client.embeddings.create({ model: MODEL, input: text });
	return response.data[0].embedding;
}
