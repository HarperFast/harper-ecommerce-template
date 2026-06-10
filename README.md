# Harper + Nextjs Ecommerce Template

This project is a basic ecommerce template that demonstrates a fullstack [Harper](https://www.harpersystems.dev/) powered [Next.js](https://nextjs.org/) application.

Harper provides the backend database, API, caching, and a server to run the Next.js frontend on. The same patterns in this code can be used to run any app that requires dynamic data and/or caching.

Almost 2% of global ecommerce sales flow through Harper Systems, with an average p95 latency of 1.12ms across early hints, redirects, and product page lookups for real-world e-commerce applications.

## Getting Started
- [Install Harper](https://docs.harperdb.io/docs/install-harperdb): `npm install -g harper`
- [Clone this repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository) and change directory in your terminal to the code
- Run `npm i`
- Run `npm run dev`
- View the frontend at [localhost:9926](http://localhost:9926/)
- View the data in Harper Studio UI at [localhost:9925](http://localhost:9925/)

## Build & Deploy

The app runs on Next.js 16 with the [`@harperfast/nextjs`](https://www.npmjs.com/package/@harperfast/nextjs) 2.x plugin (`withHarper` in [next.config.js](./next.config.js)) and is deployed prebuilt (`prebuilt: true` in [config.yaml](./config.yaml)):

- Build: `npm run build` (runs `next build --webpack`)
- Serve the prebuilt app: `npm start` (runs `harper run .`)

Static generation reads product data through Harper, so build on a machine whose local Harper root already has this app's schema and seed data (running `npm run dev` once takes care of that). The config pins the build to a single worker because each build worker loads the `harper` module and concurrent workers would contend for the database lock.

Notes for constrained or clustered environments:

- If a multi-worker build contends for the RocksDB lock, build with `next build --webpack --experimental-build-mode compile` and `NODE_OPTIONS="--max-old-space-size=4096"`.
- If the cluster reports `exports is not defined`, set `dependencyContainment: false` in the node config (a node setting, not a repo change).

## Caching

Next.js Incremental Cache entries are stored in Harper instead of in process memory: [next.config.js](./next.config.js) points `cacheHandler` at [cacheHandler.cjs](./cacheHandler.cjs) and sets `cacheMaxMemorySize: 0`. The handler uses three tables in the `appCache` database (see [schema.graphql](./schema.graphql)):

- `Cache` — one row per incremental-cache entry, with the payload v8-serialized into a `Blob` column
- `CacheRules` — path-pattern policy (bypass patterns and group codes), seeded from [resources.js](./resources.js)
- `CacheInvalidation` — a soft-invalidation log; cache reads, writes, and invalidation failures all degrade to a cache MISS so rendering never depends on the cache

To invalidate cached entries, insert a row into `appCache.CacheInvalidation` whose `id` is a cache tag, a `CacheRules` `groupCode` (e.g. `pdp`), or a URL path, with `timestamp` set to the current epoch milliseconds. Every entry refreshed at or before that timestamp is then served as a MISS and re-rendered on next request. For example, via the Operations API:

```json
{
	"operation": "insert",
	"database": "appCache",
	"table": "CacheInvalidation",
	"records": [{ "id": "pdp", "timestamp": 1750000000000 }]
}
```

## Optional Config: OpenAI personalization & semantic search
- Run `cp .env.template .env`
- Add an `OPENAI_API_KEY` to the `.env` file
- Restart the application

With a key set, product descriptions are personalized to user traits, and product search becomes semantic: queries are embedded and matched against an HNSW vector index built directly into Harper, with no external search service. Without a key, search falls back to a Harper keyword match. Built-in [Fabric embeddings are coming](https://github.com/HarperFast/harper/issues/510), which will remove the external embedding call entirely.

## More Information
For more information about getting started with Harper and building your Next.js applications, see our [getting started guides and documentation](https://www.harperdb.io/development/technologies/next-js).

This template includes the [default configuration](./config.yaml), which specifies how files are handled in your application.

The [schema.graphql](./schema.graphql) is the schema definition. This is the main starting point for defining your database schema, specifying which tables you want and what attributes/fields they should have.

The [resources.js](./resources.js) provides a template for defining JavaScript resource classes, for customized application logic in your endpoints. This repo comes with sample product data in a json file.
