import { listProducts } from "@/app/actions";
import ProductsBrowser from "./products-browser";

// ISR: server-render the listing (product grid in the initial HTML), cache it
// via the Harper cache handler, and regenerate at most every 60 seconds.
export const revalidate = 60;

export default async function ProductsPage() {
  const products = JSON.parse(await listProducts());
  return <ProductsBrowser initialProducts={products} />;
}
