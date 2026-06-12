'use client';

import { useState, useEffect, useContext } from "react";
import { ShoppingBag, Star, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ControlPanelContext } from "@/components/control-panel";
import { useCart } from "@/lib/cart-context";
import {
  listProducts,
  customizeProductDescription,
  getUserTraits,
} from '@/app/actions';

// `serverPersonalized` marks a product whose description was already
// personalized during the server render (/products/[id]/personalized); it
// suppresses the duplicate client-side OpenAI personalization effect only.
export default function ProductPage({ id, product, serverPersonalized = false }) {
  if (!product) notFound();
  const { aiPersonalizationEnabled } = useContext(ControlPanelContext);
  const { addToCart } = useCart();
  const [productDescReady, setProductDescReady] = useState(false);
  const [recommendationsReady, setRecommendationsReady] = useState(false);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [customDescription, setCustomDescription] = useState(null);
  const [traits, setTraits] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      // AI PRODUCT PERSONALIZATION
      // (skipped when the server already personalized the description)
      if (aiPersonalizationEnabled && !serverPersonalized) {
        const traits = await getUserTraits() || [];
        setTraits(traits);

        // If there are known user traits:
        // fetch OpenAI recommended product description based on traits
        if (Array.isArray(traits) && traits.length) {
          try {
            const customDescription = await customizeProductDescription(traits, product.description);
            setCustomDescription(customDescription);
            setProductDescReady(true);
          } catch (err) {
            console.error('Error fetching custom description data:', err);
          }
        } else {
          setProductDescReady(true);
        }
      }

      // PRODUCT RECOMMENDATIONS
      try {
        const defaultRecommendation = JSON.parse(await listProducts({
          conditions: [
            { attribute: 'category', value: product.category, comparator: 'equals' },
            { attribute: 'id', value: id, comparator: 'not_equal' }
          ],
          limit: 3
        }));
        setRelatedProducts(defaultRecommendation);
        setRecommendationsReady(true);
      } catch (err) {
        console.error('Error fetching related product data:', err);
      }
    };

    // Call fetchData when the component mounts
    fetchData();
  }, []);

  function renderProductDescription() {
    if (serverPersonalized) {
      // The server render already personalized product.description.
      return product.description;
    }
    if (aiPersonalizationEnabled && !customDescription && productDescReady === false) {
      return 'Custom description loading...';
    }
    if (aiPersonalizationEnabled && Array.isArray(traits) && traits.length && customDescription) {
      return customDescription;
    }
    // return default product description from harper
    return product.description;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Image Gallery */}
        <div className="space-y-4">
          <div className="relative aspect-square overflow-hidden rounded-lg">
            {/* The main product image is the LCP for /products/[id] and
                /products/[id]/personalized (issue #8): high priority, stable
                canonical src. Related-product images below use next/image
                without `priority` (lazy), so this stays the single LCP
                candidate. See docs/early-hints-manifest.md. */}
            <img
              src={product.image}
              alt={`${product.name} - Image`}
              fetchPriority="high"
              className="object-cover product"
            />
          </div>
        </div>

        {/* Product Info */}
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold">{product.name}</h1>
            <p className="mt-2 text-3xl font-bold text-primary">${product.price}</p>
          </div>

          <div className="space-y-4">
            <p className="text-muted-foreground" style={{ minHeight: 100 }}>{renderProductDescription()}</p>

            <div className="flex items-center space-x-4">
              <Button
                size="lg"
                className="flex-1"
                onClick={() => addToCart({ id, name: product.name, price: product.price, image: product.image })}
              >
                <ShoppingBag className="mr-2 h-5 w-5" />
                Add to Cart
              </Button>
            </div>

            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
              <Truck className="h-4 w-4" />
              <span>Free shipping on orders over $100</span>
            </div>
          </div>

          {/* Features */}
          <div>
            <h2 className="mb-4 text-xl font-semibold">Key Features</h2>
            <ul className="space-y-2">
              {product.features.map((feature, index) => (
                <li key={index} className="flex items-center">
                  <Star className="mr-2 h-4 w-4 text-primary" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          {/* Specifications */}
          <div>
            <h2 className="mb-4 text-xl font-semibold">Specifications</h2>
            <div className="space-y-2">
              {Object.entries(product.specs).map(([key, value]) => (
                <div key={key} className="flex justify-between border-b py-2">
                  <span className="font-medium">{key}</span>
                  <span className="text-muted-foreground">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Related Products */}
      <div className="mt-16">
        <h2 className="mb-8 text-2xl font-bold">Related Products</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {(!recommendationsReady || !relatedProducts) ? 'Loading...' : relatedProducts.map((relatedProduct) => (
            <Link key={relatedProduct.id} href={`/products/${relatedProduct.id}`}>
              <Card className="overflow-hidden transition-transform hover:scale-[1.02]">
                <div className="relative h-64">
                  <Image
                    src={relatedProduct.image}
                    alt={relatedProduct.name}
                    fill
                    className="object-cover"
                  />
                </div>
                <CardContent className="p-4">
                  <h3 className="mb-2 text-lg font-semibold">{relatedProduct.name}</h3>
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-bold">${relatedProduct.price}</span>
                    <Button size="sm">View Details</Button>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
