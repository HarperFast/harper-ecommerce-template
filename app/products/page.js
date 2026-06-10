import { listProducts } from "@/app/actions";
import ProductsBrowser from "./products-browser";

// ISR segment config (revalidate) lives in route-config.mjs so unit tests can
// import the real production value without needing a JSX/Harper environment.
export { revalidate } from "./route-config.mjs";

export default async function ProductsPage() {
  const products = JSON.parse(await listProducts());
  return <ProductsBrowser initialProducts={products} />;
}
