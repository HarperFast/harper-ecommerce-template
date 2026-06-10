// Validation predicate for product records rendered by `/products/[id]`.
// Kept in a plain module (no JSX, no Harper imports) so unit tests can import
// the real production logic; app/products/[id]/page.js uses it to decide
// whether to render the record or return Next's 404.
//
// With dynamicParams = true the route renders arbitrary DB records on demand,
// so malformed records must be rejected: ProductPage reads
// name/price/description/image/category and crashes on a missing features
// array (features.map) or specs object (Object.entries).
export function isValidProduct(product) {
	return Boolean(
		product &&
			product.name &&
			product.price != null &&
			Array.isArray(product.features) &&
			product.specs &&
			typeof product.specs === 'object'
	);
}
