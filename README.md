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

## Optional Config: Algolia Search & OpenAI Customized Product Description
- Run `cp .env.template .env`
- Get keys from Algolia and / or OpenAI and add to the .env file
- Restart the application

## More Information
For more information about getting started with Harper and building your Next.js applications, see our [getting started guides and documentation](https://www.harperdb.io/development/technologies/next-js).

This template includes the [default configuration](./config.yaml), which specifies how files are handled in your application.

The [schema.graphql](./schema.graphql) is the schema definition. This is the main starting point for defining your database schema, specifying which tables you want and what attributes/fields they should have.

The [resources.js](./resources.js) provides a template for defining JavaScript resource classes, for customized application logic in your endpoints. This repo comes with sample product data in a json file.
