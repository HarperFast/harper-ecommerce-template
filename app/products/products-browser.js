'use client';

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { filterProducts } from "./filter-products.mjs";
import { searchProducts } from "@/app/actions";

// Interactive listing UI (filter/sort), seeded with server-rendered products
// so the initial HTML already contains the product grid. When the URL has a
// ?q= param the component fetches search results client-side and shows them
// instead of the full product list.
export default function ProductsBrowser({ initialProducts = [] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const q = searchParams.get('q')?.trim() || '';

  const [category, setCategory] = useState("all");
  const [priceRange, setPriceRange] = useState([0, 300]);
  const [sortBy, setSortBy] = useState("featured");
  const [searchResults, setSearchResults] = useState(null); // null = no active search
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    searchProducts(q)
      .then(res => {
        setSearchResults(Array.isArray(res) ? res : []);
        setSearching(false);
      })
      .catch(() => {
        setSearchResults([]);
        setSearching(false);
      });
  }, [q]);

  const baseProducts = searchResults !== null ? searchResults : initialProducts;
  const filteredProducts = filterProducts(baseProducts, { category, priceRange, sortBy });

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Search context banner */}
      {q && (
        <div className="mb-6 flex items-center justify-between rounded-md border bg-muted/50 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {searching
              ? 'Searching…'
              : `${searchResults?.length ?? 0} result${searchResults?.length === 1 ? '' : 's'} for "${q}"`}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/products')}
          >
            Clear search
          </Button>
        </div>
      )}

      {/* Filters and Sort */}
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger>
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="Electronics">Electronics</SelectItem>
            <SelectItem value="Accessories">Accessories</SelectItem>
          </SelectContent>
        </Select>

        <div className="space-y-2">
          <label className="text-sm font-medium">Price Range: ${priceRange[0]} - ${priceRange[1]}</label>
          <Slider
            defaultValue={[0, 300]}
            max={300}
            step={10}
            value={priceRange}
            onValueChange={setPriceRange}
          />
        </div>

        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger>
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="featured">Featured</SelectItem>
            <SelectItem value="price-asc">Price: Low to High</SelectItem>
            <SelectItem value="price-desc">Price: High to Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredProducts.map((product, index) => (
          <Link key={product.id} href={`/products/${product.id}`}>
            <Card className="overflow-hidden transition-transform hover:scale-[1.02]">
              <div className="relative h-64">
                {/* The first card image is the LCP candidate for /products
                    (issue #8): mark it high priority without rewriting its
                    canonical src. See docs/early-hints-manifest.md. */}
                <img
                  src={product.image}
                  alt={product.name}
                  fetchPriority={index === 0 ? "high" : undefined}
                  className="object-cover product"
                />
              </div>
              <CardContent className="p-4">
                <h3 className="mb-1 text-lg font-semibold">{product.name}</h3>
                <p className="mb-3 text-sm text-muted-foreground">{product.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xl font-bold">${product.price}</span>
                  <Button size="sm">View Details</Button>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {!searching && filteredProducts.length === 0 && (
        <div className="text-center text-muted-foreground">
          {q ? `No products found for "${q}".` : 'No products found matching your criteria.'}
        </div>
      )}
    </div>
  );
}
