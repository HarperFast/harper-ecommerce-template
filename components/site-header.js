'use client';

import { useState, useRef } from "react";
import { ShoppingBag, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent } from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { searchProducts } from '@/app/actions';
import { useCart } from '@/lib/cart-context';

export function SiteHeader() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const { itemCount, openCart } = useCart();
  const router = useRouter();
  const debounceRef = useRef(null);

  function handleSearchChange(e) {
    const value = e.target.value;
    setSearchTerm(value);
    clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      searchProducts(value)
        .then(res => setSearchResults(Array.isArray(res) ? res : []));
    }, 300);
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'Enter' && searchTerm.trim()) {
      router.push(`/products?q=${encodeURIComponent(searchTerm.trim())}`);
    }
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
                <Input
                  type="text"
                  placeholder="Search products… press Enter to see all results"
                  value={searchTerm}
                  onChange={handleSearchChange}
                  onKeyDown={handleSearchKeyDown}
                  autoFocus
                />
                <div style={{ paddingTop: 10, paddingBottom: 10 }}>
                  {searchResults.map(res => (
                    <Link key={`product-${res.id}`} href={`/products/${res.id}`}>
                      <div style={{ paddingTop: 5, paddingBottom: 5 }}>
                        <div>{res.name}</div>
                        <div style={{ color: 'gray', fontSize: 12 }}>{res.description}</div>
                      </div>
                    </Link>
                  ))}
                  {searchTerm.trim() && searchResults.length === 0 && (
                    <div style={{ color: 'gray', fontSize: 12, paddingTop: 5 }}>
                      No results — press Enter to search all products
                    </div>
                  )}
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
