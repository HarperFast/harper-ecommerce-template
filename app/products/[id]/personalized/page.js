import ProductPage from '../product-page';
import { getProduct, getUserTraits, customizeProductDescription } from '@/app/actions';
import { recordDecisionDuration } from '@/lib/server-timing.mjs';

// Never cache: personalization happens inside the request render so the
// OpenAI think-time lands in the document response (benchmarking route).
export const dynamic = 'force-dynamic';

export default async function PersonalizedPage({ params }) {
  const { id } = await params;

  // Measure the full fetch-and-customize "decision" step before first byte;
  // the server-timing middleware emits it as `Server-Timing: decision;dur=<ms>`.
  const started = performance.now();
  const product = await getProduct(id);
  const plainProduct = product ? JSON.parse(JSON.stringify(product)) : null;
  if (plainProduct) {
    try {
      const traits = (await getUserTraits()) || [];
      if (Array.isArray(traits) && traits.length) {
        const customDescription = await customizeProductDescription(traits, plainProduct.description);
        if (customDescription) plainProduct.description = customDescription;
      }
    } catch (err) {
      // Personalization is best-effort: fall back to the original description
      // (mirrors the client-side personalization path on the standard PDP).
      console.error('Error personalizing product description server-side:', err);
    }
  }
  recordDecisionDuration(performance.now() - started);

  return (
    <ProductPage
      id={id}
      product={plainProduct}
      serverPersonalized
    />
  );
}
