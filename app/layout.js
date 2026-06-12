import './globals.css';
import { Inter } from 'next/font/google';
import { SiteHeader } from '@/components/site-header';
import { ControlPanel, ControlPanelProvider } from '@/components/control-panel';
import { CartProvider } from '@/lib/cart-context';
import { CartDrawer } from '@/components/cart-drawer';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <title>Harper Digital Commerce</title>
      </head>
      <body className={inter.className}>
        <ControlPanelProvider>
          <CartProvider>
            <SiteHeader />
            {children}
            <ControlPanel />
            <CartDrawer />
          </CartProvider>
        </ControlPanelProvider>
      </body>
    </html>
  );
}
