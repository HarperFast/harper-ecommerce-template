import 'harper';
import { notFound } from 'next/navigation';
import ProductPage from './product-page';
import { getProduct } from '@/app/actions';
import { isValidProduct } from './validate-product.mjs';

// On-demand ISR: no build-time prerender of every product (which contended
// for the database lock); each product renders on first request and is cached
// via the Harper cache handler for up to 60 seconds.
export const revalidate = 60;
export const dynamicParams = true;

export default async function Page({ params }) {
  const { id } = await params;
  let product;
  try {
    product = await getProduct(id);
  } catch {
    notFound();
  }
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
