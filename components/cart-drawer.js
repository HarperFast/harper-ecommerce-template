'use client';

import { X, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { useCart } from '@/lib/cart-context';

export function CartDrawer() {
  const { items, isOpen, closeCart, removeFromCart, total } = useCart();

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={closeCart} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-80 flex-col bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-4">
          <h2 className="text-lg font-semibold">
            Cart {items.length > 0 && `(${items.length})`}
          </h2>
          <Button size="icon" variant="ghost" onClick={closeCart}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {items.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Your cart is empty</p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <img
                  src={item.image}
                  alt={item.name}
                  className="h-16 w-16 rounded object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-sm text-muted-foreground">
                    ${item.price.toFixed(2)} &times; {item.quantity}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removeFromCart(item.id)}
                  aria-label={`Remove ${item.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="border-t px-4 py-4">
          <div className="mb-4 flex justify-between text-base font-semibold">
            <span>Total</span>
            <span>${total.toFixed(2)}</span>
          </div>
          <Button className="w-full" size="lg" disabled={items.length === 0}>
            Checkout
          </Button>
        </div>
      </div>
    </>
  );
}
