# Kroger listing API validation

## Selected source

- **Endpoint:** `GET https://www.kroger.com/atlas/v1/search/v1/products-search`
- **Authentication:** No OAuth token was required in the browser session.
- **Required request context:** `x-kroger-channel: WEB`, a valid `x-laf-object` JSON header, an `Accept: application/json` header, and a Kroger search-page referer.
- **Pagination:** `page.offset` and `page.size`; the live page requests 24 records at a time.
- **Sorting:** `sortCriteria=relevance|popularity|price|description` with `sortOrder=asc|desc`.
- **Location context:** The actor uses location `02100537`, facility `4000`, the published assortment key, and `IN_STORE`, `PICKUP`, and `DELIVERY` fulfillment filters.

The listing response contains `data.productsSearch` and `meta.productsSearch`. Each listing record provides the product UPC, description, brand name, search rank, relevance score, grouping, sub-commodity codes, personalization state, and optional sponsored placement data. The response also provides `totalCount`, page offsets, page size, and `hasMore` information.

A live browser validation on 2026-09-10 returned HTTP 200 for both a normal keyword (`perfume`) and a UPC query (`0001111046235`). The UPC query returned the matching product through the listing endpoint, so direct product URL inputs can use the same listing path without opening the product-detail API or product page.

## Candidate matrix

| Candidate | Validation | Decision |
| --- | --- | --- |
| Listing search endpoint | Browser request returned HTTP 200, expected `data.productsSearch`, and pagination metadata | **Selected** |
| Product-detail endpoint | Not required for the requested output; adds a blocked request after listing and was the failure-prone step | Rejected |
| Direct Impit request | Fast path, but Kroger can return HTTP 403/429 or reset the connection | Kept as first attempt only |
| Browser-context listing fetch | A real Chrome page completes the edge challenge, then same-origin `fetch()` returns the listing JSON | **Fallback selected** |
| HTML product cards | Rendered successfully but are not required when listing JSON is available | Rejected |
| URLScan and guessed mobile/app endpoints | No stronger source was needed after live listing validation | Not selected |

## Runtime strategy

1. Open one persistent Patchright Chrome session on the **search page** before making the first listing request. The actor waits for the page/challenge to settle, but does not require Kroger's own listing XHR to be captured.
2. Fetch the listing endpoint from that same browser page with the required LAF and channel headers.
3. If the browser session cannot obtain JSON after bounded retries, try the configured Apify Residential proxy with Impit, then direct Impit when a proxy was configured.
4. Map and save listing records immediately. Search runs never call `/atlas/v1/product/v2/products`.
5. Preserve the complete raw listing record in `listing_data` and bounded pagination/search metadata in `listing_metadata`.
6. Close the browser session in `finally`, while preserving the original actor error for Apify.

The actor does not log cookies, tokens, proxy credentials, or full response bodies. Empty or malformed listing responses remain fatal because they cannot produce trustworthy product records; a blocked detail request can no longer fail a search run because no detail request is made.
