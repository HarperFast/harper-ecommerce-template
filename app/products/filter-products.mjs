// Pure filter/sort logic for the products listing, extracted from the
// ProductsBrowser client component so unit tests can exercise the real
// production code without React rendering.
export function filterProducts(products, { category = 'all', priceRange = [0, Infinity], sortBy = 'featured' } = {}) {
	return products
		.filter(
			(product) =>
				(category === 'all' || product.category === category) &&
				product.price >= priceRange[0] &&
				product.price <= priceRange[1]
		)
		.sort((a, b) => {
			if (sortBy === 'price-asc') return a.price - b.price;
			if (sortBy === 'price-desc') return b.price - a.price;
			return 0; // featured
		});
}
