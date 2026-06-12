'use client';

import { useState } from "react";
import { ShoppingBag, Search } from "lucide-react";
import Link from "next/link";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent } from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { searchProducts } from '@/app/actions';
import { useCart } from '@/lib/cart-context';

export function SiteHeader() {
  const [searchResults, setSearchResults] = useState([]);
  const { itemCount, openCart } = useCart();

  function search(e) {
    const target = e.target;
    clearTimeout(target.searchTimeout);
    target.searchTimeout = setTimeout(() => {
      searchProducts(target.value)
        .then(res => setSearchResults(Array.isArray(res) ? res : []));
    }, 300);
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div id="logo"></div>
        <Link href="/" className="text-xl font-bold title">
          Harper Digital Commerce
        </Link>

        <nav className="flex items-center space-x-6">
          <Link href="/products" className="text-sm font-medium hover:text-primary">
            Products
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost">
                <Search className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuPortal>
              <DropdownMenuContent style={{ width: 400, padding: 10 }}>
                <h3 style={{ paddingBottom: 5 }}>Search</h3>
                <div>
                  <Input type="text" onChange={search} />
                </div>
                <div style={{ paddingTop: 10, paddingBottom: 10 }}>
                  {searchResults.map(res => (
                    <Link key={`product-${res.id}`} href={`/products/${res.id}`}>
                      <div style={{ paddingTop: 5, paddingBottom: 5 }}>
                        <div>{res.name}</div>
                        <div style={{ color: 'gray', fontSize: 12 }}>{res.description}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>

          <Button size="icon" variant="ghost" onClick={openCart} aria-label="Open cart" className="relative">
            <ShoppingBag className="h-5 w-5" />
            {itemCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {itemCount > 9 ? '9+' : itemCount}
              </span>
            )}
          </Button>
        </nav>
      </div>
    </header>
  );
}
