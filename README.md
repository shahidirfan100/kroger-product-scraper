## What does Kroger Product Scraper do?

Kroger Product Scraper collects structured product listing data from Kroger. Enter a Kroger search URL or a keyword such as `cream`, choose the result limit and ordering, and receive product names, brands, UPCs, search ranking, grouping, and other listing metadata without opening individual product pages.

The Actor is useful for grocery market research, assortment analysis, product catalog discovery, and recurring competitive research. Results are saved to an Apify dataset and can be downloaded as JSON, CSV, Excel, XML, or connected to another workflow.

## Why use Kroger Product Scraper?

- **Listing-first collection** - Get product records from Kroger's search listing without requesting every product page.
- **Search metadata** - Capture UPCs, descriptions, brands, ranking, relevance, grouping, sub-commodity codes, and sponsored placement information.
- **Search flexibility** - Start with a Kroger search URL, a product URL, or a keyword. Product URLs are resolved through a UPC listing query.
- **Controlled collection** - Set the maximum number of products and search pages for small checks or larger datasets.
- **Resilient runs** - Use a direct request first and a browser-backed listing request only when Kroger's edge blocks direct transport.
- **Automation-ready output** - Use Apify schedules, webhooks, dataset APIs, and exports for repeatable workflows.

## What data can you extract from Kroger?

| Field                  | Description                                      |
| ---------------------- | ------------------------------------------------ |
| `product_id`           | Kroger product identifier from the listing UPC.  |
| `upc`                  | Product UPC or GTIN.                             |
| `name`                 | Product description shown in the listing.        |
| `brand`                | Brand name shown in the listing.                 |
| `search_rank`          | Product rank in the search response.             |
| `relevance_score`      | Search relevance score when available.           |
| `sponsored`            | Whether the listing has a sponsored placement.   |
| `group_id`             | Kroger listing group identifier when available.  |
| `sub_commodity_codes`  | Kroger sub-commodity codes from the listing.    |
| `personalized`         | Personalization flag from the listing response.  |
| `placement_id`         | Sponsored placement identifier when available.   |
| `listing_data`         | Complete raw product record returned by listing.  |
| `listing_metadata`     | Pagination and search metadata for the listing.   |
| `location_id`          | Kroger location used for the listing request.    |
| `source_url`           | Search or product URL supplied to the Actor.     |
| `scraped_at`           | UTC extraction timestamp.                        |

Kroger's listing response does not reliably include product-detail fields such as current price, inventory, nutrition, images, or ratings. The Actor intentionally does not request those detail records in search runs, which avoids the blocked and failure-prone product-detail step.

## How to use Kroger Product Scraper

1. Open the Actor in Apify Console.
2. Enter a Kroger search URL or a keyword.
3. Select the sort order and result limits.
4. Run the Actor and open the dataset preview.
5. Export the data or connect the dataset to your workflow.

## Input Parameters

| Parameter            | Type    | Required | Default                     | Description                                                                             |
| -------------------- | ------- | -------- | --------------------------- | --------------------------------------------------------------------------------------- |
| `startUrl`           | String  | No       | Sample Kroger search URL    | Kroger search or product page. URL query values are used when present.                  |
| `keyword`           | String  | No       | Not set in the sample input  | Search term used when no URL is supplied.                                               |
| `sortBy`             | String  | No       | `relevance`                 | `relevance`, `popularity`, `price_low_to_high`, `price_high_to_low`, or `alphabetical`. |
| `results_wanted`     | Integer | No       | `20`                        | Maximum number of products to save.                                                     |
| `max_pages`          | Integer | No       | `3`                         | Maximum number of 24-product search pages.                                              |
| `proxyConfiguration` | Object  | No       | Apify Residential proxy     | Optional Apify Proxy settings; Residential is used by default for the HTTP fallback.    |

Use either `startUrl` or `keyword`. When `startUrl` is supplied, its query parameters are used. The Actor applies its internal default store context (`02100537`) for listing results and fulfillment filtering. Product URLs are resolved through a UPC search in the listing endpoint.

## Usage Examples

### Search by URL

Collect 20 products from the supplied Kroger search page:

```json
{
    "startUrl": "https://www.kroger.com/search?query=cream&searchType=default_search",
    "results_wanted": 20,
    "max_pages": 3
}
```

### Search by keyword and ordering

Collect products matching a keyword in the selected listing order:

```json
{
    "keyword": "olive oil",
    "sortBy": "price_low_to_high",
    "results_wanted": 50,
    "max_pages": 5
}
```

### Resolve one product URL through the listing

Find the matching listing record from a direct Kroger product URL without opening the product page:

```json
{
    "startUrl": "https://www.kroger.com/p/kroger-original-sour-cream/0001111046235",
    "results_wanted": 1
}
```

### Use Apify Proxy

Enable a proxy for a scheduled or higher-volume workflow:

```json
{
    "keyword": "cereal",
    "results_wanted": 40,
    "max_pages": 3,
    "proxyConfiguration": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"]
    }
}
```

## Sample Output

```json
{
    "product_id": "0001111046235",
    "upc": "0001111046235",
    "name": "Kroger® Original Sour Cream",
    "brand": "Kroger",
    "search_rank": 1,
    "relevance_score": 1,
    "sponsored": false,
    "group_id": "6000000000129598",
    "sub_commodity_codes": ["0200600001"],
    "personalized": false,
    "location_id": "02100537",
    "source_url": "https://www.kroger.com/search?query=cream&searchType=default_search",
    "scraped_at": "2026-08-22T10:00:00.000Z"
}
```

## Tips for Best Results

- Start with `results_wanted: 20` to confirm the output before larger runs.
- Listing metadata uses the Actor's internal default Kroger location (`02100537`).
- Keep `max_pages` aligned with the result limit. Each search page can contain up to 24 products.
- Product-detail fields such as prices, images, nutrition, and inventory are intentionally not requested by this listing-first actor.
- Use schedules and compare datasets over time for assortment and search-rank monitoring.

## Integrations

- **Apify Dataset API** - Read results programmatically from your application.
- **Google Sheets** - Export product listing and catalog data for review.
- **Webhooks** - Trigger downstream processing after a run completes.
- **Make and Zapier** - Connect product data to no-code workflows.
- **CSV, Excel, JSON, and XML** - Download the dataset in common formats.

## Frequently Asked Questions

### Can I use a Kroger product URL instead of a search URL?

Yes. Provide a direct product URL in `startUrl`; the Actor extracts its UPC and looks it up through the listing endpoint without opening the product page.

### Does the listing include store context?

The listing request uses the Actor's internal default Kroger location (`02100537`) and matching fulfillment context. Custom store selection is not currently exposed as an input.

### Can I sort products by price?

The Actor passes Kroger's supported price ordering values to the listing request, but price values themselves are not requested from product-detail records.

### Why is a field missing for one product?

Kroger does not publish every listing field for every product. The Actor omits empty values from each dataset item so the output contains only values returned by the listing response.

### Can I schedule recurring runs?

Yes. Apify schedules can run the Actor hourly, daily, weekly, or on a custom interval for price and assortment monitoring.

### Is it legal to collect Kroger product data?

You are responsible for complying with Kroger's terms, applicable laws, robots directives, rate limits, and any restrictions that apply to your intended use. Collect only data you are permitted to access and use responsibly.

## Related Actors

- [Target Product Scraper](https://apify.com/shahidirfan/target-product-scraper) - Collect product prices, ratings, images, and inventory from Target.
- [Shein Product Scraper](https://apify.com/shahidirfan/shein-product-scraper) - Extract fashion catalog data for price and assortment research.
- [Flipkart Product Scraper](https://apify.com/shahidirfan/flipkart-product-scraper) - Collect product data from another major retail marketplace.

## Support

For issues or feature requests, use the Issues tab on the Actor page and include the input example and run ID when possible.

## Legal Notice

This Actor is intended for legitimate collection of publicly available product information. Users are responsible for following Kroger's terms of use, applicable laws, privacy requirements, and reasonable request limits.
