import { listProducts } from "@/app/actions";
import ProductsBrowser from "./products-browser";

// ISR: server-render the listing (product grid in the initial HTML), cache it
// via the Harper cache handler, and regenerate at most every 60 seconds.
export const revalidate = 60;

export default async function ProductsPage() {
  // A database failure should render an empty-product state, not a 500.
  let products = [];
  try {
    products = JSON.parse(await listProducts());
  } catch {
    products = [];
  }
  return <ProductsBrowser initialProducts={products} />;
}
