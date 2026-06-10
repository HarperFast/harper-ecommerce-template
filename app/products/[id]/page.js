import 'harper';
import { notFound } from 'next/navigation';
import ProductPage from './product-page';
import { getProduct } from '@/app/actions';

// ISR segment config (revalidate, dynamicParams) lives in route-config.mjs so
// unit tests can import the real production values without JSX/Harper.
export { revalidate, dynamicParams } from './route-config.mjs';

export default async function Page({ params }) {
  const { id } = await params;
  const product = await getProduct(id);
  // Guard on the server so unknown IDs return Next's 404 page instead of
  // failing during serialization below. With dynamicParams = true this route
  // renders arbitrary DB records on demand, so also reject malformed records:
  // ProductPage reads name/price/description/image/category and crashes on a
  // missing features array (features.map) or specs object (Object.entries).
  if (
    !product ||
    !product.name ||
    product.price == null ||
    !Array.isArray(product.features) ||
    !product.specs ||
    typeof product.specs !== 'object'
  ) {
    notFound();
  }
  return (
    <ProductPage
      id={id}
      product={JSON.parse(JSON.stringify(product))}
    />
  );
}
