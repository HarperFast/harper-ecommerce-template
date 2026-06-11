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
import { useState } from "react";
import { filterProducts } from "./filter-products.mjs";

// Interactive listing UI (filter/sort), seeded with server-rendered products
// so the initial HTML already contains the product grid.
export default function ProductsBrowser({ initialProducts = [] }) {
  const [category, setCategory] = useState("all");
  const [priceRange, setPriceRange] = useState([0, 300]);
  const [sortBy, setSortBy] = useState("featured");

  // Filter and sort products (logic lives in filter-products.mjs so it is unit-testable)
  const filteredProducts = filterProducts(initialProducts, { category, priceRange, sortBy });

  return (
    <div className="container mx-auto px-4 py-8">
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
                  <Button size="sm">
                    View Details
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {filteredProducts.length === 0 && (
        <div className="text-center text-muted-foreground">
          No products found matching your criteria.
        </div>
      )}
    </div>
  );
}
