# Kroger product source validation

## Selected sources

1. **Search listing (paginated)** - `GET https://www.kroger.com/atlas/v1/search/v1/products-search`
2. **Product details (batched)** - `GET https://www.kroger.com/atlas/v1/product/v2/products`
3. **Server-rendered fallback** - `GET https://www.kroger.com/search?query=<keyword>` (embedded `window.__INITIAL_STATE__`)

All three are accessed with Impit only. No browser automation is used. The `ios18` browser profile is used for the two `/atlas` endpoints; the `chrome` profile is used for the fallback page.

## Search listing endpoint

- **Query:** `option.groupBy=PRODUCT_VARIANT`, `option.quickFacets=true`, `filter.locationId=02100537`, `filter.query=<keyword>`, `filter.fulfillmentMethods=IN_STORE|PICKUP|DELIVERY`, `page.offset`, `page.size`, `option.personalization=PURCHASE_HISTORY`, `sortCriteria`, `sortOrder`.
- **Pagination:** `page.offset` increments by `page.size`. `page.size=100` works; `page.size>=200` returns HTTP 400. The actor uses `page.size=100`.
- **Response:** `data.productsSearch[]` with `upc`, `description`, `brandName`, `subCommodityCode`, `personalized`, `relevanceScore`, `searchEngineRank`, `groupedBy`, and optional `placementId`. `meta.productsSearch.totalCount` reports the full catalog size.
- **Ordering:** `sortCriteria=relevance|popularity|price|description` with `sortOrder=asc|desc` is honored.

The listing records do **not** include prices or ratings, so details are fetched separately.

## Product details endpoint

- **Query:** one or more `filter.gtin13s=<upc>`, `filter.verified=true`, `filter.locationId=02100537`, and `projections=items.full,offers.compact,nutrition.label,inventory.projected,variantGroupings.compact`.
- **Batching:** up to 100 UPCs per request return all requested products (verified with a 100-UPC batch).
- **Response:** `data.products[]` containing `item` (with `ratingsAndReviewsAggregate`), `price.storePrices`, `inventory`, `location`, `inventorySummaries`, `fulfillmentOptions`, and `nutrition`.
- `item.ratingsAndReviewsAggregate` provides `averageRating`, `numberOfReviews`, and the 1-5 star breakdown. **This is the reviews source.**

## Akamai behavior and profile matrix

| Context                                       | `chrome`                      | `ios18`         | `okhttp`            |
| --------------------------------------------- | ----------------------------- | --------------- | ------------------- |
| `/atlas` API from a challenged IP (local dev) | 403 Access Denied             | 429 `cpr_chlge` | HTTP/2 stream reset |
| `/atlas` API from Apify (direct, no proxy)    | 403 Access Denied             | **200 JSON**    | error               |
| `/atlas` API through Apify RESIDENTIAL        | 403                           | 429 `cpr_chlge` | error               |
| `/search` page from Apify                     | 200 (HTML state, 24 products) | 200 mobile stub | error               |

Key finding: the `ios18` profile reaches the `/atlas` endpoints **directly from Apify**, while the residential proxy triggers the Akamai challenge. The actor therefore uses direct requests for the API and keeps the proxy only for the HTML fallback.

Intermittent HTTP 429 challenges occur on repeated API calls. The actor retries with a fresh Impit session (new connection) and bounded backoff, which clears them.

## Runtime strategy

1. Collect the server-rendered search page through the configured proxy, across all supported sort orders, and merge the products by UPC. This is the reliable primary path and yields roughly 56-65 unique products per common query.
2. If the result limit is not met, extend with the paginated listing endpoint (`page.size=100`) and the product details endpoint in batches of up to 100. This is best-effort because Akamai challenges those endpoints intermittently.
3. Map each listing record with its detail record. If a detail is missing, emit the listing record rather than dropping the product.
4. Preserve the complete raw listing record in `listing_data`, the full product in `product_data`, and catalog metadata in `listing_metadata`.

## Verified on Apify

- HTML primary path (`keyword=cream`, build 1.0.40): 65 products, 64 with details, saved successfully.
- Full API path when Akamai allows it (build 1.0.39, `keyword=milk, results_wanted=300, max_pages=5`): **154 products, all with details**.

## Known limitations

- `page.size` above 100 is rejected, and `page.offset` beyond `totalCount` returns an empty list.
- API coverage is bounded by `results_wanted` and `max_pages` (`max_pages * 100` products).
- Akamai intermittently serves an HTTP 429 `cpr_chlge` challenge on the `/atlas` endpoints. This depends on egress IP reputation, not on the code path. The actor retries five times with bounded backoff, then relies on the search-page path.

## HTML search-page coverage

The server-rendered search page returns 24 products per sort order. The actor requests the page across all supported sort orders (relevance, popularity, price ascending, price descending, alphabetical) and merges the products by UPC. Measured unique coverage:

| Query     | Products |
| --------- | -------- |
| milk      | 61       |
| cream     | 62-65    |
| cereal    | 61       |
| olive oil | 56       |

## Proxy configuration

Apify Residential is the default group and is used for the primary search-page requests. If a proxied request is blocked, the actor retries it directly. The API extension uses direct requests first, then the proxy for any missing details.

- Search page (primary): proxied -> direct.
- API extension: direct -> proxied.
