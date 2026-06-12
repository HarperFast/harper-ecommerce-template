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
  const product = await getProduct(id);
  if (product == null || !isValidProduct(product)) notFound();
  return (
    <ProductPage
      id={id}
      product={JSON.parse(JSON.stringify(product))}
    />
  );
}
