## What does Kroger Product Scraper do?

Kroger Product Scraper collects structured product data from Kroger. Enter a Kroger search URL, a product URL, or a keyword such as `cream`, choose the result limit and ordering, and receive product names, brands, UPCs, prices, ratings, review counts, inventory, aisle locations, images, nutrition, and search ranking.

The Actor is useful for grocery market research, price monitoring, assortment analysis, review tracking, and recurring competitive research. Results are saved to an Apify dataset and can be downloaded as JSON, CSV, Excel, XML, or connected to another workflow.

## Why use Kroger Product Scraper?

- **Rich product records** - Get prices, sale prices, ratings, review counts, star breakdowns, stock levels, aisle details, images, and nutrition alongside the product listing.
- **Reviews included** - Capture the average rating, total review count, and the 1-5 star distribution for every product.
- **Search flexibility** - Start with a Kroger search URL, a product URL, or a keyword. Product URLs are resolved through a UPC query.
- **Sorting control** - Order results by best match, popularity, price, or alphabetically.
- **Controlled collection** - Set the maximum number of products and search pages for small checks or larger datasets.
- **Resilient runs** - Automatic retries and profile fallback keep collection stable when Kroger's edge is busy.
- **Automation-ready output** - Use Apify schedules, webhooks, dataset APIs, and exports for repeatable workflows.

## What data can you extract from Kroger?

| Field                    | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `product_id`             | Kroger product identifier.                         |
| `upc`                    | Product UPC or GTIN.                               |
| `name`                   | Product description.                               |
| `brand`                  | Brand name.                                        |
| `size`                   | Customer-facing size.                              |
| `category`               | Product category path.                             |
| `department`             | Department name.                                   |
| `subcategory`            | Sub-commodity name.                                |
| `regular_price`          | Regular shelf price.                               |
| `sale_price`             | Promotional price when present.                    |
| `price_display`          | Formatted regular price.                           |
| `unit_price`             | Equivalized unit price, for example `$0.20/fl oz`. |
| `currency`               | Price currency code.                               |
| `rating`                 | Average customer rating.                           |
| `reviews_count`          | Total number of customer reviews.                  |
| `rating_breakdown`       | Count of 1-5 star reviews.                         |
| `availability`           | Availability state.                                |
| `stock_level`            | Stock level such as `HIGH`, `MEDIUM`, or `LOW`.    |
| `quantity_available`     | Available quantity when provided.                  |
| `image_url`              | Front product image.                               |
| `image_urls`             | All product image URLs.                            |
| `aisle` / `aisle_number` | Aisle description and number.                      |
| `bay` / `shelf_position` | Bay and shelf position.                            |
| `product_url`            | Canonical Kroger product URL.                      |
| `search_rank`            | Product rank in the search response.               |
| `relevance_score`        | Search relevance score when available.             |
| `sponsored`              | Whether the listing has a sponsored placement.     |
| `group_id`               | Kroger listing group identifier when available.    |
| `sub_commodity_codes`    | Kroger sub-commodity codes from the listing.       |
| `personalized`           | Personalization flag from the listing response.    |
| `nutrition`              | Nutrition facts when provided.                     |
| `allergens`              | Allergen information when provided.                |
| `ingredients`            | Ingredient text when provided.                     |
| `product_description`    | Plain-text product description.                    |
| `listing_data`           | Search listing record for the product.             |
| `product_data`           | Complete raw product record.                       |
| `listing_metadata`       | Pagination and search metadata.                    |
| `location_id`            | Kroger location used for the request.              |
| `source_url`             | Search or product URL supplied to the Actor.       |
| `scraped_at`             | UTC extraction timestamp.                          |

Kroger does not publish every field for every product. The Actor omits empty values so each dataset item contains only values Kroger returned.

## How to use Kroger Product Scraper

1. Open the Actor in Apify Console.
2. Enter a Kroger search URL, a product URL, or a keyword.
3. Select the sort order and result limits.
4. Run the Actor and open the dataset preview.
5. Export the data or connect the dataset to your workflow.

## Input Parameters

| Parameter            | Type    | Required | Default                     | Description                                                                                       |
| -------------------- | ------- | -------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `startUrl`           | String  | No       | Sample Kroger search URL    | Kroger search or product page. URL query values are used when present.                            |
| `keyword`            | String  | No       | Not set in the sample input | Search term used when no URL is supplied.                                                         |
| `sortBy`             | String  | No       | `relevance`                 | `relevance`, `popularity`, `price_low_to_high`, `price_high_to_low`, or `alphabetical`.           |
| `results_wanted`     | Integer | No       | `20`                        | Maximum number of products to save. The Actor pages through Kroger until this many are collected. |
| `max_pages`          | Integer | No       | `3`                         | Maximum number of search pages to request. Each page returns up to 100 products.                  |
| `proxyConfiguration` | Object  | No       | Apify Residential proxy     | Apify Proxy fallback used when direct requests are blocked. Residential by default.               |

Use either `startUrl` or `keyword`. When `startUrl` is supplied, its query parameters are used. Product URLs are resolved through a UPC search.

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

Collect products matching a keyword in the selected order:

```json
{
    "keyword": "olive oil",
    "sortBy": "price_low_to_high",
    "results_wanted": 50,
    "max_pages": 5
}
```

### Resolve one product URL

Find the matching record from a direct Kroger product URL:

```json
{
    "startUrl": "https://www.kroger.com/p/kroger-original-sour-cream/0001111046235",
    "results_wanted": 1
}
```

### Proxy fallback

A Residential proxy is used by default when direct requests are blocked. To choose a different group or supply your own proxies:

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
    "product_id": "0001111050315",
    "upc": "0001111050315",
    "name": "Kroger® Heavy Whipping Cream Pint",
    "brand": "Kroger",
    "size": "1 pt",
    "category": ["Dairy"],
    "department": "DAIRY",
    "regular_price": 3.19,
    "price_display": "$3.19",
    "unit_price": "$0.20/fl oz",
    "currency": "USD",
    "rating": 2.17,
    "reviews_count": 75,
    "rating_breakdown": {
        "five_star": 18,
        "four_star": 1,
        "three_star": 2,
        "two_star": 9,
        "one_star": 45
    },
    "availability": "IN_STOCK",
    "stock_level": "HIGH",
    "image_url": "https://www.kroger.com/product/images/xlarge/front/0001111050315",
    "aisle": "DAIRY",
    "aisle_number": "105",
    "aisle_side": "L",
    "product_url": "https://www.kroger.com/p/kroger-heavy-whipping-cream-pint/0001111050315",
    "search_rank": 1,
    "sponsored": false,
    "location_id": "02100537",
    "source_url": "https://www.kroger.com/search?query=cream&searchType=default_search",
    "scraped_at": "2026-10-02T10:00:00.000Z"
}
```

## Tips for Best Results

- Start with `results_wanted: 20` to confirm the output before larger runs.
- The Actor collects the search page first and extends to the full catalog when available. Set `results_wanted` to the number you need and keep `max_pages` high enough (up to 100 products per page).
- Use `sortBy` to control which products appear first.
- Use schedules and compare datasets over time for price, rating, and assortment monitoring.

## Integrations

- **Apify Dataset API** - Read results programmatically from your application.
- **Google Sheets** - Export product and price data for review.
- **Webhooks** - Trigger downstream processing after a run completes.
- **Make and Zapier** - Connect product data to no-code workflows.
- **CSV, Excel, JSON, and XML** - Download the dataset in common formats.

## Frequently Asked Questions

### Can I use a Kroger product URL instead of a search URL?

Yes. Provide a direct product URL in `startUrl`; the Actor extracts its UPC and looks it up.

### Does the output include prices and reviews?

Yes. Each product includes regular and sale prices, the average rating, the total review count, and the 1-5 star breakdown when Kroger provides them.

### Does the data include store context?

The request uses the Actor's default Kroger location (`02100537`). Custom store selection is not currently exposed as an input.

### Can I sort products by price?

Yes. Choose `price_low_to_high` or `price_high_to_low` in `sortBy`, or select another supported order.

### Why is a field missing for one product?

Kroger does not publish every field for every product. The Actor omits empty values from each dataset item.

### What happens if Kroger rate-limits a run?

The Actor retries automatically. If Kroger keeps limiting requests, the Actor still returns the products it retrieved and finishes successfully.

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
