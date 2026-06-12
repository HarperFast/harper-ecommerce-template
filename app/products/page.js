import { Suspense } from "react";
import { listProducts } from "@/app/actions";
import ProductsBrowser from "./products-browser";

// ISR: server-render the listing (product grid in the initial HTML), cache it
// via the Harper cache handler, and regenerate at most every 60 seconds.
// ProductsBrowser uses useSearchParams() which requires a Suspense boundary.
export const revalidate = 60;

export default async function ProductsPage() {
  const products = JSON.parse(await listProducts());
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-8 text-muted-foreground">Loading…</div>}>
      <ProductsBrowser initialProducts={products} />
    </Suspense>
  );
}
