'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

export const CartContext = createContext({
  items: [],
  isOpen: false,
  itemCount: 0,
  total: 0,
  addToCart: () => {},
  removeFromCart: () => {},
  clearCart: () => {},
  openCart: () => {},
  closeCart: () => {},
});

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('harper-cart');
      if (saved) setItems(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('harper-cart', JSON.stringify(items));
    } catch {}
  }, [items]);

  const addToCart = useCallback((product) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { id: product.id, name: product.name, price: product.price, image: product.image, quantity: 1 }];
    });
  }, []);

  const removeFromCart = useCallback((id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <CartContext.Provider value={{
      items,
      isOpen,
      itemCount,
      total,
      addToCart,
      removeFromCart,
      clearCart,
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
