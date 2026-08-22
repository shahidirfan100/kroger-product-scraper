## What does Kroger Product Scraper do?

Kroger Product Scraper collects structured product data from Kroger search pages and product pages. Enter a Kroger URL or a keyword such as `cream`, choose the result limit and ordering, and receive product names, brands, prices, availability, ratings, images, nutrition details, aisle information, and direct product links.

The Actor is useful for grocery market research, price comparison, assortment analysis, product catalog creation, inventory monitoring, and recurring competitive research. Results are saved to an Apify dataset and can be downloaded as JSON, CSV, Excel, XML, or connected to another workflow.

## Why use Kroger Product Scraper?

- **Store-specific pricing** - Collect regular prices, sale prices, unit prices, currency, and data for the actor's configured Kroger location.
- **Availability monitoring** - Capture stock level, quantity available, and fulfillment options when Kroger publishes them.
- **Product research** - Gather product descriptions, brands, sizes, categories, ingredients, allergens, nutrition facts, and product warnings.
- **Search flexibility** - Start with a Kroger search URL, a product URL, or a keyword.
- **Controlled collection** - Set the maximum number of products and search pages for small checks or larger datasets.
- **Automation-ready output** - Use Apify schedules, webhooks, dataset APIs, and exports for repeatable workflows.

## What data can you extract from Kroger?

| Field                 | Description                                        |
| --------------------- | -------------------------------------------------- |
| `product_id`          | Kroger product identifier.                         |
| `upc`                 | Product UPC or GTIN.                               |
| `name`                | Product name.                                      |
| `brand`               | Brand name.                                        |
| `size`                | Customer-facing package size.                      |
| `category`            | Product category list.                             |
| `department`          | Kroger department.                                 |
| `subcategory`         | Kroger subcategory.                                |
| `product_description` | Plain-text product description.                    |
| `description_html`    | Product description as published by Kroger.        |
| `ingredients`         | Ingredient statement when available.               |
| `allergens`           | Allergen statement when available.                 |
| `product_warning`     | Product warning when available.                    |
| `country_of_origin`   | Country of origin.                                 |
| `organic`             | Organic product flag.                              |
| `gluten_free`         | Gluten-free product flag.                          |
| `regular_price`       | Regular numeric price.                             |
| `sale_price`          | Promotional numeric price when available.          |
| `price_display`       | Formatted regular price.                           |
| `sale_price_display`  | Formatted promotional price.                       |
| `unit_price`          | Formatted price per unit.                          |
| `currency`            | Currency code.                                     |
| `availability`        | Availability status for the selected location.     |
| `stock_level`         | Published Kroger stock level.                      |
| `quantity_available`  | Published available quantity.                      |
| `fulfillment_options` | Pickup, delivery, in-store, or shipping options.   |
| `rating`              | Average customer rating.                           |
| `reviews_count`       | Number of customer reviews.                        |
| `image_url`           | Primary product image.                             |
| `image_urls`          | Available product image URLs.                      |
| `aisle`               | Aisle description.                                 |
| `aisle_number`        | Aisle number.                                      |
| `aisle_side`          | Aisle side.                                        |
| `bay`                 | Bay within the aisle.                              |
| `shelf_position`      | Shelf position in the bay.                         |
| `product_url`         | Direct Kroger product page.                        |
| `search_rank`         | Product rank in the search response.               |
| `relevance_score`     | Search relevance score when available.             |
| `sponsored`           | Sponsored result flag.                             |
| `location_id`         | Kroger location used for price and inventory data. |
| `source_url`          | Search or product URL supplied to the Actor.       |
| `scraped_at`          | UTC extraction timestamp.                          |
| `nutrition`           | Published nutrition facts as structured values.    |

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
| `keyword`            | String  | No       | `cream` in the sample input | Search term used when no URL is supplied.                                               |
| `sortBy`             | String  | No       | `relevance`                 | `relevance`, `popularity`, `price_low_to_high`, `price_high_to_low`, or `alphabetical`. |
| `results_wanted`     | Integer | No       | `20`                        | Maximum number of products to save.                                                     |
| `max_pages`          | Integer | No       | `3`                         | Maximum number of 24-product search pages.                                              |
| `proxyConfiguration` | Object  | No       | Apify Proxy disabled        | Optional Apify Proxy settings.                                                          |

Use either `startUrl` or `keyword`. When `startUrl` is supplied, its query parameters are used. The Actor applies its internal default store context (`02100537`) for prices, availability, and fulfillment filtering. Product URLs return the requested product record directly.

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

### Search by keyword and price

Collect the least expensive products matching a keyword:

```json
{
    "keyword": "olive oil",
    "sortBy": "price_low_to_high",
    "results_wanted": 50,
    "max_pages": 5
}
```

### Read one product page

Collect a product record from a direct Kroger product URL:

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
    "size": "8 oz",
    "category": ["Dairy"],
    "department": "DAIRY",
    "subcategory": "SOUR CREAMS",
    "product_description": "Kroger® Original Sour Cream bursts with creamy goodness!",
    "regular_price": 1.39,
    "price_display": "$1.39",
    "unit_price": "$0.17/oz",
    "currency": "USD",
    "availability": "IN_STOCK",
    "stock_level": "HIGH",
    "quantity_available": 21,
    "fulfillment_options": ["PICKUP"],
    "rating": 3.39,
    "reviews_count": 229,
    "image_url": "https://www.kroger.com/product/images/xlarge/front/0001111046235",
    "aisle": "DAIRY",
    "aisle_number": "100",
    "aisle_side": "R",
    "bay": "5",
    "shelf_position": "4",
    "product_url": "https://www.kroger.com/p/kroger-original-sour-cream/0001111046235",
    "search_rank": 19,
    "sponsored": false,
    "location_id": "02100537",
    "source_url": "https://www.kroger.com/search?query=cream&searchType=default_search",
    "scraped_at": "2026-08-22T10:00:00.000Z"
}
```

## Tips for Best Results

- Start with `results_wanted: 20` to confirm the output before larger runs.
- Prices and availability use the Actor's internal default Kroger location (`02100537`).
- Keep `max_pages` aligned with the result limit. Each search page can contain up to 24 products.
- Product information is source-dependent. Fields such as ingredients, aisle placement, nutrition, and inventory may not be published for every product.
- Use schedules and compare datasets over time for price and assortment monitoring.

## Integrations

- **Apify Dataset API** - Read results programmatically from your application.
- **Google Sheets** - Export product prices and catalog data for review.
- **Webhooks** - Trigger downstream processing after a run completes.
- **Make and Zapier** - Connect product data to no-code workflows.
- **CSV, Excel, JSON, and XML** - Download the dataset in common formats.

## Frequently Asked Questions

### Can I use a Kroger product URL instead of a search URL?

Yes. Provide a direct product URL in `startUrl` and the Actor returns the product details for that UPC.

### Can I collect store-specific prices?

Yes. The Actor applies its internal default Kroger location (`02100537`) and matching LAF context to each request. Custom store selection is not currently exposed as an input.

### Can I sort products by price?

Yes. Use `price_low_to_high` or `price_high_to_low` in `sortBy`.

### Why is a field missing for one product?

Kroger does not publish every field for every product or location. The Actor omits empty values from each dataset item so the output does not contain columns that are always null.

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
