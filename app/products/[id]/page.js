import 'harper';
import { notFound } from 'next/navigation';
import ProductPage from './product-page';
import { getProduct } from '@/app/actions';
import { isValidProduct } from './validate-product.mjs';

// ISR segment config (revalidate, dynamicParams) lives in route-config.mjs so
// unit tests can import the real production values without JSX/Harper.
export { revalidate, dynamicParams } from './route-config.mjs';

export default async function Page({ params }) {
  const { id } = await params;
  const product = await getProduct(id);
  // Guard on the server so unknown IDs return Next's 404 page instead of
  // failing during serialization below. The validation predicate lives in
  // validate-product.mjs (plain module) so unit tests exercise the real logic.
  if (!isValidProduct(product)) {
    notFound();
  }
  return (
    <ProductPage
      id={id}
      product={JSON.parse(JSON.stringify(product))}
    />
  );
}
