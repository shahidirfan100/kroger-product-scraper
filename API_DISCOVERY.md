## Selected API

- Search endpoint: `GET https://www.kroger.com/atlas/v1/search/v1/products-search`
- Product endpoint: `GET https://www.kroger.com/atlas/v1/product/v2/products`
- Authentication: No OAuth token was required for the browser-backed public web requests.
- Required request context: `x-kroger-channel: WEB`, a valid `x-laf-object` JSON header, and a Kroger referer.
- Search pagination: `page.offset` and `page.size`; the live site uses a page size of 24.
- Search sorting: `sortCriteria=relevance|popularity|price|description` and `sortOrder=asc|desc`.
- Product pagination: UPC batches through repeated `filter.gtin13s` parameters. The actor batches at 20 UPCs per detail request.
- Rich fields available: product identity, brand, size, categories, department tree, descriptions, ingredients, allergens, nutrition facts, images, prices, sale prices, unit prices, inventory, fulfillment options, ratings, reviews count, aisle data, product URLs, and search ranking metadata.

## API discovery notes

The supplied Kroger search page was opened and its network traffic was inspected. The page returned a JSON search response containing `data.productsSearch` and `meta.productsSearch.totalCount`. The next JSON request returned full product records using the UPCs from the search response. No page HTML or rendered product cards are used by the actor.

The live web bundle defines these sort values:

| UI option          | `sortCriteria` | `sortOrder` |
| ------------------ | -------------- | ----------- |
| Best Match         | `relevance`    | `desc`      |
| Most Popular       | `popularity`   | `desc`      |
| Price: Low to High | `price`        | `asc`       |
| Price: High to Low | `price`        | `desc`      |
| Alphabetical: A-Z  | `description`  | `asc`       |

## Candidate matrix

| Candidate                       | Status                                                                   | Fields                          | Pagination                    | Decision                                                                    |
| ------------------------------- | ------------------------------------------------------------------------ | ------------------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| URLScan search for `kroger.com` | Existing public scans found, but result payload access returned HTTP 403 | Not available                   | Not inspected                 | Not selected because the live browser provided a better direct confirmation |
| Desktop Kroger web JSON request | HTTP 200                                                                 | 20+ product and metadata groups | `page.offset` and `page.size` | Selected                                                                    |
| iOS Safari bootstrap/API probe  | Not needed after the desktop JSON source was confirmed                   | Not needed                      | Not needed                    | Not selected                                                                |
| Android app-style API probe     | Not needed after the desktop JSON source was confirmed                   | Not needed                      | Not needed                    | Not selected                                                                |
| Kroger HTML page                | HTTP page rendered, but not used for extraction                          | Product cards only              | UI loading                    | Rejected in favor of JSON                                                   |
| Browser automation fallback     | Used only during discovery to observe XHR/fetch traffic                  | Same JSON responses             | Same API pagination           | Not used by the actor                                                       |

## Replay requirements

The search and product requests require a location-assortment context. The actor uses the internal default location `02100537` and builds the matching LAF header for every run. Store selection and custom LAF overrides are intentionally not exposed as actor inputs.

The selected requests were replayed in the browser with the exact LAF object shape and returned HTTP 200 JSON. The actor uses `impit` with one shared Chrome client, keeps the API request context consistent, retries 403/429/5xx responses, and pushes each completed product batch immediately.
