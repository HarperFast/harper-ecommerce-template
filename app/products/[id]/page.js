import 'harper';
import { notFound } from 'next/navigation';
import ProductPage from './product-page';
import { getProduct } from '@/app/actions';

// On-demand ISR: no build-time prerender of every product (which contended
// for the database lock); each product renders on first request and is cached
// via the Harper cache handler for up to 60 seconds.
export const revalidate = 60;
export const dynamicParams = true;

export default async function Page({ params }) {
  const { id } = await params;
  const product = await getProduct(id);
  // Guard on the server so unknown IDs return Next's 404 page instead of
  // failing during serialization below.
  if (!product) notFound();
  return (
    <ProductPage
      id={id}
      product={JSON.parse(JSON.stringify(product))}
    />
  );
}
