import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Star, TrendingUp, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { listProducts } from "@/app/actions";

// ISR segment config (revalidate) lives in route-config.mjs so unit tests can
// import the real production value without needing a JSX/Harper environment.
export { revalidate } from "./route-config.mjs";

export default async function Home() {
  const featuredProducts = JSON.parse(await listProducts({ limit: 3 }));
  const features = [
    {
      icon: <Truck className="h-6 w-6" />,
      title: "Free Shipping",
      description: "On orders over $100",
    },
    {
      icon: <Star className="h-6 w-6" />,
      title: "Premium Quality",
      description: "Handpicked products",
    },
    {
      icon: <TrendingUp className="h-6 w-6" />,
      title: "Best Sellers",
      description: "Trending items",
    },
  ];

  return (
    <main className="flex min-h-screen flex-col">
      {/* Hero Section */}
      <section className="relative h-[600px] w-full">
        <Image
          src="https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&q=80&w=2000"
          alt="Hero"
          fill
          className="object-cover brightness-50"
          priority
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-white">
            <h1 className="mb-6 text-5xl font-bold">Discover Premium Products</h1>
            <p className="mb-8 text-xl">Shop the latest trends with confidence</p>
            <Link href="/products">
              <Button size="lg" className="bg-white text-black hover:bg-gray-100">
                Shop Now
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-gray-50 py-16">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {features.map((feature, index) => (
              <div
                key={index}
                className="flex flex-col items-center text-center"
              >
                <div className="mb-4 rounded-full bg-primary p-3 text-primary-foreground">
                  {feature.icon}
                </div>
                <h3 className="mb-2 text-xl font-semibold">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Products Section */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <h2 className="mb-8 text-center text-3xl font-bold">Featured Products</h2>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {featuredProducts.map((product) => (
              <Link key={product.id} href={`/products/${product.id}`}>
                <Card key={product.id} className="overflow-hidden">
                  <div className="relative h-64">
                    <Image
                      src={product.image}
                      alt={product.name}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <CardContent className="p-4">
                    <h3 className="mb-2 text-lg font-semibold">{product.name}</h3>
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-bold">${product.price}</span>
                      <Button size="sm">
                        {/* <ShoppingBag className="mr-2 h-4 w-4" /> */}
                        View Details
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/products">
              <Button size="lg">View All Products</Button>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
