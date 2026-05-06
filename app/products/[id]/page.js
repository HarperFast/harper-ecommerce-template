import 'harper';
import ProductPage from './product-page';
import { listProducts, getProduct } from '@/app/actions';

export async function generateStaticParams() {
  const products = JSON.parse(await listProducts());
  return products.map((data) => ({
    id: data.id,
  }))
}

export default async function Page({ params }) {
  const { id } = await params;
  const product = await getProduct(id);
  return (
    <ProductPage
      id={id}
      product={JSON.parse(JSON.stringify(product))}
    />
  );
}
