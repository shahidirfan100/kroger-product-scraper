import { Actor, log } from 'apify';
import { Impit } from 'impit';

// Kroger product data is collected in two stages:
//   1. The server-rendered search page, whose embedded `window.__INITIAL_STATE__` holds
//      24 full products per sort order. Several sort orders are merged for coverage. This
//      path is reliable and runs through the configured proxy.
//   2. The paginated `/atlas/v1/search/v1/products-search` + `/atlas/v1/product/v2/products`
//      endpoints, which return the full catalog but are challenged intermittently by Akamai.
//      They are used best-effort to extend the search-page results.
const SEARCH_BATCH_SIZE = 100;
const DETAIL_BATCH_SIZE = 100;
const KROGER_ORIGIN = 'https://www.kroger.com';
const KROGER_HOST_SUFFIX = '.kroger.com';
const DEFAULT_LOCATION_ID = '02100537';

const API_BROWSER = 'ios18';
const HTML_BROWSER_PROFILES = ['chrome', 'firefox'];

// The server-rendered search page returns 24 products per sort order. Combining the
// supported sort orders multiplies the unique coverage when the paginated API is
// unavailable.
const FALLBACK_SORTS = [
    { criteria: 'relevance', order: 'desc' },
    { criteria: 'popularity', order: 'desc' },
    { criteria: 'price', order: 'asc' },
    { criteria: 'price', order: 'desc' },
    { criteria: 'description', order: 'asc' },
];

const PRODUCT_PROJECTIONS = 'items.full,offers.compact,nutrition.label,inventory.projected,variantGroupings.compact';

const REQUEST_TIMEOUT_MS = 30000;
const API_MAX_ATTEMPTS = 3;
const HTML_MAX_ATTEMPTS = 3;

const htmlClients = new Map();
const apiClients = new Map();

await Actor.init();

const sleep = (milliseconds) =>
    new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });

const isNonEmpty = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
};

function cleanValue(value) {
    if (Array.isArray(value)) {
        const cleaned = value.map(cleanValue).filter(isNonEmpty);
        return cleaned.length ? cleaned : undefined;
    }

    if (value && typeof value === 'object') {
        const cleaned = Object.fromEntries(
            Object.entries(value)
                .map(([key, nestedValue]) => [key, cleanValue(nestedValue)])
                .filter(([, nestedValue]) => isNonEmpty(nestedValue)),
        );
        return Object.keys(cleaned).length ? cleaned : undefined;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || undefined;
    }

    return value;
}

function stripHtml(value) {
    if (!isNonEmpty(value)) return undefined;
    return String(value)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function parseMoney(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!isNonEmpty(value)) return undefined;
    const match = String(value)
        .replace(/,/g, '')
        .match(/-?\d+(?:\.\d+)?/);
    if (!match) return undefined;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeUrl(rawUrl) {
    if (!isNonEmpty(rawUrl)) return undefined;
    const candidate = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== 'kroger.com' && !hostname.endsWith(KROGER_HOST_SUFFIX)) {
        throw new Error('startUrl must be a Kroger URL, such as https://www.kroger.com/search?...');
    }
    return parsed;
}

function extractUpcFromProductUrl(pageUrl) {
    if (!pageUrl) return undefined;
    const match = pageUrl.pathname.match(/(?:^|\/)(\d{12,14})\/?$/);
    if (!match || !/\/p\//i.test(pageUrl.pathname)) return undefined;
    return match[1];
}

function getUrlQuery(pageUrl) {
    if (!pageUrl) return undefined;
    return (
        pageUrl.searchParams.get('query') ||
        pageUrl.searchParams.get('q') ||
        pageUrl.searchParams.get('keyword') ||
        pageUrl.searchParams.get('searchTerm') ||
        undefined
    );
}

function getRawStartUrl({ startUrl, url, startUrls }) {
    if (isNonEmpty(startUrl)) return startUrl;
    if (isNonEmpty(url)) return url;
    if (!Array.isArray(startUrls) || !startUrls.length) return undefined;
    return typeof startUrls[0] === 'string' ? startUrls[0] : startUrls[0]?.url;
}

function resolveSort(sortBy, pageUrl) {
    const requested = String(sortBy || '')
        .trim()
        .toLowerCase();
    const criteriaFromUrl = pageUrl?.searchParams.get('sortCriteria');
    const orderFromUrl = pageUrl?.searchParams.get('sortOrder');
    const criteria = requested || criteriaFromUrl || 'relevance';

    const sortMap = {
        relevance: { criteria: 'relevance', order: 'desc' },
        best_match: { criteria: 'relevance', order: 'desc' },
        most_relevant: { criteria: 'relevance', order: 'desc' },
        popularity: { criteria: 'popularity', order: 'desc' },
        most_popular: { criteria: 'popularity', order: 'desc' },
        price_low_to_high: { criteria: 'price', order: 'asc' },
        price_high_to_low: { criteria: 'price', order: 'desc' },
        alphabetical: { criteria: 'description', order: 'asc' },
        alphabetical_a_to_z: { criteria: 'description', order: 'asc' },
    };

    if (sortMap[criteria]) return sortMap[criteria];
    if (criteriaFromUrl) return { criteria: criteriaFromUrl, order: orderFromUrl || 'desc' };
    return sortMap.relevance;
}

function buildLafObject(locationId) {
    return JSON.stringify([
        {
            modality: {
                type: 'PICKUP',
                handoffLocation: { storeId: locationId, facilityId: '4000' },
            },
            sources: [{ storeId: locationId, facilityId: '4000' }],
            assortmentKeys: ['5b3c218b-e8ae-490b-8fd5-9dd2d7bcae6f'],
            listingKeys: [locationId],
        },
    ]);
}

function buildSourceUrl({ keyword, sort }) {
    const url = new URL('/search', KROGER_ORIGIN);
    url.searchParams.set('query', keyword);
    url.searchParams.set('searchType', 'default_search');
    url.searchParams.set('sortCriteria', sort.criteria);
    url.searchParams.set('sortOrder', sort.order);
    return url.href;
}

function buildSearchApiUrl({ keyword, sort, locationId, offset, size }) {
    const url = new URL('/atlas/v1/search/v1/products-search', KROGER_ORIGIN);
    url.searchParams.set('option.groupBy', 'PRODUCT_VARIANT');
    url.searchParams.set('option.quickFacets', 'true');
    url.searchParams.set('filter.locationId', locationId);
    url.searchParams.set('filter.query', keyword);
    for (const method of ['IN_STORE', 'PICKUP', 'DELIVERY']) {
        url.searchParams.append('filter.fulfillmentMethods', method);
    }
    url.searchParams.set('page.offset', String(offset));
    url.searchParams.set('page.size', String(size));
    url.searchParams.set('option.personalization', 'PURCHASE_HISTORY');
    url.searchParams.set('sortCriteria', sort.criteria);
    url.searchParams.set('sortOrder', sort.order);
    return url.href;
}

function buildProductDetailUrl({ upcs, locationId }) {
    const url = new URL('/atlas/v1/product/v2/products', KROGER_ORIGIN);
    for (const upc of upcs) url.searchParams.append('filter.gtin13s', upc);
    url.searchParams.set('filter.verified', 'true');
    url.searchParams.set('filter.locationId', locationId);
    url.searchParams.set('projections', PRODUCT_PROJECTIONS);
    return url.href;
}

function getApiHeaders(locationId) {
    return {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'x-laf-object': buildLafObject(locationId),
        'x-kroger-channel': 'WEB',
        referer: `${KROGER_ORIGIN}/search?query=products&searchType=default_search`,
        origin: KROGER_ORIGIN,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
    };
}

function createApiClient(proxyUrl) {
    // No cookie jar on purpose: Akamai returns an unvalidated `_abck` cookie, and
    // sending it back converts the soft 429 challenge into a hard 403. Each
    // attempt therefore starts from a clean cookie state.
    return new Impit({
        browser: API_BROWSER,
        timeout: REQUEST_TIMEOUT_MS,
        ...(proxyUrl ? { proxyUrl } : {}),
    });
}

function getApiClient(proxyUrl) {
    const key = proxyUrl || '__direct__';
    if (!apiClients.has(key)) apiClients.set(key, createApiClient(proxyUrl));
    return apiClients.get(key);
}

function resetApiClient(proxyUrl) {
    apiClients.set(proxyUrl || '__direct__', createApiClient(proxyUrl));
}

function isTransportError(error) {
    return /internal HTTP library|request timeout|timed out|ECONNRESET|connection reset|connection closed|network error|proxy error/i.test(
        error?.message || '',
    );
}

function isRetryableApiStatus(status) {
    return status === 403 || status === 429 || status >= 500;
}

async function requestJson(proxyUrl, url, headers, label) {
    let lastError;

    for (let attempt = 1; attempt <= API_MAX_ATTEMPTS; attempt++) {
        let retryable = true;
        try {
            const client = getApiClient(proxyUrl);
            const response = await client.fetch(url, { headers });
            const text = await response.text();
            if (response.status === 200) {
                try {
                    return JSON.parse(text);
                } catch {
                    lastError = new Error(`${label} returned invalid JSON.`);
                    retryable = false;
                }
            } else {
                lastError = new Error(`${label} returned HTTP ${response.status}.`);
                retryable = isRetryableApiStatus(response.status);
                log.debug(`${label} attempt ${attempt} returned HTTP ${response.status}.`);
            }
        } catch (error) {
            lastError = error;
            retryable = isTransportError(error);
        }

        if (!retryable || attempt === API_MAX_ATTEMPTS) break;

        // Reusing the same session usually clears the transient Akamai challenge;
        // only rebuild the client when the connection itself failed.
        if (isTransportError(lastError)) resetApiClient(proxyUrl);
        const delay = attempt * 500 + Math.round(Math.random() * 400);
        await sleep(delay);
    }

    throw lastError || new Error(`${label} failed.`);
}

async function collectListing(proxyUrl, { keyword, sort, locationId, targetResults, maxRequests, headers }) {
    const items = [];
    const seen = new Set();
    let totalCount = 0;

    for (let request = 1; request <= maxRequests && items.length < targetResults; request++) {
        const offset = (request - 1) * SEARCH_BATCH_SIZE;
        const url = buildSearchApiUrl({
            keyword,
            sort,
            locationId,
            offset,
            size: SEARCH_BATCH_SIZE,
        });

        let data;
        try {
            data = await requestJson(proxyUrl, url, headers, `Search page ${request}`);
        } catch (error) {
            // A failure on the first page means the source is unavailable. A
            // failure on a later page keeps the products collected so far.
            if (!items.length) throw error;
            log.warning(`Search page ${request} failed after ${items.length} products: ${error.message}`);
            break;
        }

        const pageItems = data?.data?.productsSearch;
        if (!Array.isArray(pageItems)) {
            if (!items.length) throw new Error(`Search page ${request} did not contain data.productsSearch.`);
            break;
        }

        totalCount = Number(data?.meta?.productsSearch?.totalCount || totalCount || 0);

        let added = 0;
        for (const item of pageItems) {
            const upc = String(item?.upc || '').trim();
            if (!upc || seen.has(upc)) continue;
            seen.add(upc);
            items.push(item);
            added++;
            if (items.length >= targetResults) break;
        }

        log.info(
            `Listing page ${request} | offset=${offset} | new=${added} | collected=${items.length}/${targetResults} | total_available=${totalCount}`,
        );

        if (!pageItems.length || added === 0) break;
        if (totalCount > 0 && offset + SEARCH_BATCH_SIZE >= totalCount) break;
    }

    return { items, totalCount };
}

async function fetchProductDetails(proxyUrl, { upcs, locationId, headers }) {
    const details = new Map();
    const batches = [];
    for (let i = 0; i < upcs.length; i += DETAIL_BATCH_SIZE) {
        batches.push(upcs.slice(i, i + DETAIL_BATCH_SIZE));
    }

    for (let index = 0; index < batches.length; index++) {
        const batch = batches[index];
        const url = buildProductDetailUrl({ upcs: batch, locationId });
        try {
            const data = await requestJson(proxyUrl, url, headers, `Product details batch ${index + 1}`);
            for (const product of data?.data?.products || []) {
                const upc = String(product?.item?.upc || product?.upc || '').trim();
                if (upc) details.set(upc, product);
            }
        } catch (error) {
            log.warning(`Product details batch ${index + 1} failed: ${error.message}`);
        }
    }

    return details;
}

// The server-rendered search page embeds `window.__INITIAL_STATE__ = JSON.parse('<json>')`.
// Decode the JavaScript string literal first, then parse the JSON it contains.
function decodeJsStringLiteral(source, startIndex, quoteChar) {
    let out = '';
    for (let i = startIndex + 1; i < source.length; i++) {
        const char = source[i];
        if (char === '\\') {
            const next = source[i + 1];
            switch (next) {
                case 'n':
                    out += '\n';
                    i++;
                    break;
                case 't':
                    out += '\t';
                    i++;
                    break;
                case 'r':
                    out += '\r';
                    i++;
                    break;
                case 'b':
                    out += '\b';
                    i++;
                    break;
                case 'f':
                    out += '\f';
                    i++;
                    break;
                case 'v':
                    out += '\v';
                    i++;
                    break;
                case '0':
                    out += '\0';
                    i++;
                    break;
                case 'x':
                    out += String.fromCharCode(parseInt(source.slice(i + 2, i + 4), 16));
                    i += 3;
                    break;
                case 'u':
                    out += String.fromCharCode(parseInt(source.slice(i + 2, i + 6), 16));
                    i += 5;
                    break;
                default:
                    out += next;
                    i++;
                    break;
            }
        } else if (char === quoteChar) {
            return out;
        } else {
            out += char;
        }
    }
    throw new Error('Kroger search page contained an unterminated state payload.');
}

function extractInitialState(html) {
    const match = /window\.__INITIAL_STATE__\s*=\s*JSON\.parse\(\s*(['"])/.exec(html);
    if (!match) return null;
    const quoteChar = match[1];
    const quoteIndex = match.index + match[0].length - 1;
    return JSON.parse(decodeJsStringLiteral(html, quoteIndex, quoteChar));
}

function getHtmlClient(browser, proxyUrl) {
    const key = `${browser}|${proxyUrl || ''}`;
    if (!htmlClients.has(key)) {
        htmlClients.set(
            key,
            new Impit({
                browser,
                timeout: REQUEST_TIMEOUT_MS,
                ...(proxyUrl ? { proxyUrl } : {}),
            }),
        );
    }
    return htmlClients.get(key);
}

async function fetchSearchHtml(sourceUrl, proxyUrl) {
    let lastError;

    for (let attempt = 1; attempt <= HTML_MAX_ATTEMPTS; attempt++) {
        const browser = HTML_BROWSER_PROFILES[Math.min(attempt - 1, HTML_BROWSER_PROFILES.length - 1)];
        const client = getHtmlClient(browser, proxyUrl);
        let retryable = true;

        try {
            const response = await client.fetch(sourceUrl, {
                headers: {
                    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'accept-language': 'en-US,en;q=0.9',
                },
            });

            if (response.ok) {
                const body = await response.text();
                if (body.includes('__INITIAL_STATE__')) return body;
                lastError = new Error('Kroger search page did not contain the expected product data.');
                retryable = false;
            } else {
                lastError = new Error(`Kroger search page returned HTTP ${response.status}.`);
                retryable = response.status === 403 || response.status === 429 || response.status >= 500;
            }
        } catch (error) {
            lastError = error;
            const status = Number((error.message.match(/HTTP (\d{3})/) || [])[1] || 0);
            retryable = isTransportError(error) || isRetryableApiStatus(status);
        }

        if (!retryable || attempt === HTML_MAX_ATTEMPTS) break;

        const nextBrowser = HTML_BROWSER_PROFILES[Math.min(attempt, HTML_BROWSER_PROFILES.length - 1)];
        const delay = attempt * 1500 + Math.round(Math.random() * 750);
        log.warning(
            `Kroger search page attempt ${attempt}/${HTML_MAX_ATTEMPTS} failed (${lastError.message}); retrying with the ${nextBrowser} profile.`,
        );
        await sleep(delay);
    }

    throw lastError || new Error('Kroger search page could not be loaded.');
}

function extractHtmlListing(state) {
    const grid = state?.calypso?.useCases?.getProducts?.['search-grid']?.response?.data?.products;
    const listing = state?.search?.searchAll?.response?.products;
    const productsInfo = state?.search?.searchAll?.response?.productsInfo || {};
    return {
        products: Array.isArray(grid) ? grid : [],
        listing: Array.isArray(listing) ? listing : [],
        productsInfo,
    };
}

async function collectFromSearchPage({ keyword, sort, targetResults, proxyUrl }) {
    const productsByUpc = new Map();
    const listingByUpc = new Map();
    let metadata;
    let lastError;

    const sorts = [sort, ...FALLBACK_SORTS].filter(
        (candidate, index, all) =>
            all.findIndex((other) => other.criteria === candidate.criteria && other.order === candidate.order) ===
            index,
    );

    for (const candidateSort of sorts) {
        if (productsByUpc.size >= targetResults) break;
        const url = buildSourceUrl({ keyword, sort: candidateSort });

        let state;
        try {
            state = extractInitialState(await fetchSearchHtml(url, proxyUrl));
        } catch (error) {
            if (!proxyUrl) {
                lastError = error;
                log.debug(`Search page ${candidateSort.criteria}/${candidateSort.order} failed: ${error.message}`);
                continue;
            }
            try {
                state = extractInitialState(await fetchSearchHtml(url, undefined));
            } catch (directError) {
                lastError = directError;
                log.debug(
                    `Search page ${candidateSort.criteria}/${candidateSort.order} failed: ${directError.message}`,
                );
                continue;
            }
        }
        if (!state) continue;

        const htmlListing = extractHtmlListing(state);
        for (const product of htmlListing.products) {
            const upc = String(product?.item?.upc || '').trim();
            if (upc && !productsByUpc.has(upc)) productsByUpc.set(upc, product);
        }
        for (const item of htmlListing.listing) {
            const upc = String(item?.upc || '').trim();
            if (upc && !listingByUpc.has(upc)) listingByUpc.set(upc, item);
        }
        if (!metadata) {
            metadata = cleanValue({
                total_count: htmlListing.productsInfo.totalCount,
                available_count: htmlListing.productsInfo.availableCount,
                search_id: htmlListing.productsInfo.searchId,
                sort: { criteria: sort.criteria, order: sort.order },
            });
        }
        log.info(
            `Search page | sort=${candidateSort.criteria}/${candidateSort.order} | collected=${productsByUpc.size}`,
        );
    }

    if (!productsByUpc.size && lastError) throw lastError;
    return { productsByUpc, listingByUpc, metadata };
}

function mapNutrition(product) {
    const facts = product?.nutrition?.components?.flatMap(
        (component) => component.preparationStates?.flatMap((state) => state.nutriFacts || []) || [],
    );
    return facts?.map((fact) =>
        cleanValue({
            name: fact.name,
            value: fact.value,
            unit: fact.abbreviation,
            daily_value_percent: parseMoney(fact.dailyValue),
            precision: fact.precision,
        }),
    );
}

function mapProduct(product, searchItem, sourceUrl, locationId) {
    const item = product?.item || {};
    const regularPrice = product?.price?.storePrices?.regular;
    const promoPrice = product?.price?.storePrices?.promo;
    const firstLocation = product?.location?.locations?.[0];
    const firstInventory = product?.inventory?.locations?.[0];
    const aggregate = item.ratingsAndReviewsAggregate || {};
    const images = (item.images || []).map((image) => image.url).filter(isNonEmpty);
    const frontImage =
        (item.images || []).find((image) => image.perspective === 'front' && image.size === 'xlarge')?.url ||
        (item.images || []).find((image) => image.perspective === 'front')?.url;
    const regularPriceValue = parseMoney(
        regularPrice?.price || regularPrice?.nforPrice || regularPrice?.defaultDescription,
    );
    const promoPriceValue = parseMoney(promoPrice?.price || promoPrice?.nforPrice || promoPrice?.defaultDescription);
    const availability = product?.inventorySummaries?.[0] || product?.fulfillmentSummaries?.[0];
    const availabilityState =
        availability?.details?.[0]?.availableToSell > 0 || availability?.availability?.sellable === true
            ? 'IN_STOCK'
            : availability?.stockLevel || availability?.availability?.inventoryLevel;

    return cleanValue({
        product_id: item.upc || product.id || searchItem?.upc,
        upc: item.upc || product.id || searchItem?.upc,
        name: item.description || searchItem?.description,
        brand: typeof item.brand === 'string' ? item.brand : item.brand?.name || searchItem?.brandName,
        size: item.customerFacingSize || item.size,
        category: item.categories?.map((category) => category.name).filter(isNonEmpty),
        department: item.familyTree?.department?.name,
        subcategory: item.familyTree?.subCommodity?.name,
        product_description: stripHtml(item.romanceDescription),
        description_html: item.romanceDescription,
        ingredients: product?.nutrition?.ingredients,
        allergens: product?.nutrition?.allergens,
        product_warning: product?.nutrition?.productWarning,
        country_of_origin: item.countriesOfOrigin,
        organic: isNonEmpty(item.organicClaimName) ? item.organicClaimName === 'YES' : item.organic,
        gluten_free: isNonEmpty(item.glutenFreeClaimName)
            ? item.glutenFreeClaimName.toLowerCase().includes('gluten free')
            : item.glutenFree,
        regular_price: regularPriceValue,
        sale_price: promoPriceValue,
        price_display: regularPrice?.defaultDescription,
        sale_price_display: promoPrice?.defaultDescription,
        unit_price: regularPrice?.equivalizedUnitPriceString,
        currency: regularPrice?.price?.match(/[A-Z]{3}/)?.[0] || promoPrice?.price?.match(/[A-Z]{3}/)?.[0],
        availability: availabilityState,
        stock_level:
            firstInventory?.stockLevel || availability?.stockLevel || availability?.availability?.inventoryLevel,
        quantity_available: firstInventory?.available || availability?.availableToSell,
        fulfillment_options: product?.fulfillmentOptions,
        rating: aggregate.averageRating,
        reviews_count: aggregate.numberOfReviews,
        rating_breakdown: cleanValue({
            five_star: aggregate.numOfFiveStarRating,
            four_star: aggregate.numOfFourStarRating,
            three_star: aggregate.numOfThreeStarRating,
            two_star: aggregate.numOfTwoStarRating,
            one_star: aggregate.numOfOneStarRating,
        }),
        image_url: frontImage,
        image_urls: images,
        aisle: firstLocation?.aisle?.description,
        aisle_number: firstLocation?.aisle?.number,
        aisle_side: firstLocation?.aisle?.side,
        bay: firstLocation?.bayInAisle,
        shelf_position: firstLocation?.shelfPositionInBay,
        product_url: item.shareLink || item.productUrl || item.url || searchItem?.shareLink,
        search_rank: searchItem?.searchEngineRank,
        relevance_score: searchItem?.relevanceScore,
        sponsored: Boolean(searchItem?.placementId),
        location_id: locationId,
        source_url: sourceUrl,
        scraped_at: new Date().toISOString(),
        nutrition: mapNutrition(product),
    });
}

function mapRecord(detailProduct, listingItem, sourceUrl, locationId, listingMetadata) {
    const base = detailProduct
        ? mapProduct(detailProduct, listingItem, sourceUrl, locationId)
        : cleanValue({
              product_id: listingItem?.upc,
              upc: listingItem?.upc,
              name: listingItem?.description,
              brand: listingItem?.brandName,
              search_rank: listingItem?.searchEngineRank,
              relevance_score: listingItem?.relevanceScore,
              sponsored: Boolean(listingItem?.placementId),
              location_id: locationId,
              source_url: sourceUrl,
              scraped_at: new Date().toISOString(),
          });

    return cleanValue({
        ...base,
        group_id: listingItem?.groupedBy && listingItem.groupedBy !== 'NONE' ? listingItem.groupedBy : undefined,
        sub_commodity_codes: listingItem?.subCommodityCode,
        personalized: listingItem?.personalized,
        placement_id: listingItem?.placementId,
        listing_data: listingItem,
        product_data: detailProduct,
        listing_metadata: listingMetadata,
    });
}

function buildApiListingMetadata(totalCount, sort) {
    return cleanValue({
        total_count: totalCount,
        sort: { criteria: sort.criteria, order: sort.order },
    });
}

async function main() {
    const input = (await Actor.getInput()) || {};
    const {
        startUrl,
        url,
        startUrls,
        keyword,
        sortBy,
        results_wanted: resultsWantedRaw = 20,
        max_pages: maxPagesRaw = 3,
        proxyConfiguration,
    } = input;

    const resultsWanted = Number.isFinite(Number(resultsWantedRaw)) ? Math.max(1, Number(resultsWantedRaw)) : 20;
    const maxPages = Number.isFinite(Number(maxPagesRaw)) ? Math.max(1, Number(maxPagesRaw)) : 3;
    const pageUrl = normalizeUrl(getRawStartUrl({ startUrl, url, startUrls }));
    const productUrlUpc = extractUpcFromProductUrl(pageUrl);
    const parsedKeyword = getUrlQuery(pageUrl);
    const effectiveKeyword =
        productUrlUpc || (pageUrl ? String(parsedKeyword || '').trim() : String(keyword || '').trim());

    if (!effectiveKeyword) {
        throw new Error('Provide either keyword or a Kroger search/product startUrl.');
    }

    const sort = resolveSort(pageUrl?.searchParams.has('sortCriteria') ? undefined : sortBy, pageUrl);
    const sourceUrl = buildSourceUrl({ keyword: effectiveKeyword, sort });
    const locationId = DEFAULT_LOCATION_ID;
    const apiHeaders = getApiHeaders(locationId);

    const targetResults = productUrlUpc ? Math.min(resultsWanted, 1) : resultsWanted;
    const maxRequests = productUrlUpc ? 1 : maxPages;

    log.info(
        `Starting Kroger product run | keyword=${effectiveKeyword} | results=${targetResults} | max_pages=${maxRequests}`,
    );

    const proxyUrl = await resolveProxyUrl(proxyConfiguration);

    // Primary path: the server-rendered search page is reliable and works through the
    // proxy. It returns 24 products per sort order, so several orders are merged to
    // maximize coverage.
    const htmlResult = await collectFromSearchPage({
        keyword: effectiveKeyword,
        sort,
        targetResults,
        proxyUrl,
    });

    const productsByUpc = new Map(htmlResult.productsByUpc);
    const listingByUpc = new Map(htmlResult.listingByUpc);
    let totalCount = Number(htmlResult.metadata?.total_count || 0);

    if (!productsByUpc.size) {
        log.warning('Kroger returned no products for this search.');
        log.info('Finished | saved=0 | stop_reason=no products found');
        return;
    }

    // Extension: when the result limit is not met, try the paginated endpoint for full
    // coverage. This is best-effort because Akamai challenges it intermittently.
    let apiExtensionAttempted = false;
    if (productsByUpc.size < targetResults) {
        apiExtensionAttempted = true;
        const listingArgs = {
            keyword: effectiveKeyword,
            sort,
            locationId,
            targetResults,
            maxRequests,
            headers: apiHeaders,
        };

        let apiListing = [];
        try {
            const collected = await collectListing(undefined, listingArgs);
            apiListing = collected.items;
            if (collected.totalCount) totalCount = collected.totalCount;
        } catch (directError) {
            log.debug(`Direct search API unavailable: ${directError.message}`);
            if (proxyUrl) {
                try {
                    const collected = await collectListing(proxyUrl, listingArgs);
                    apiListing = collected.items;
                    if (collected.totalCount) totalCount = collected.totalCount;
                } catch (proxyError) {
                    log.debug(`Proxied search API unavailable: ${proxyError.message}`);
                }
            }
        }

        const newUpcs = [];
        const newUpcSet = new Set();
        for (const item of apiListing) {
            const upc = String(item.upc || '').trim();
            if (!upc) continue;
            if (!listingByUpc.has(upc)) listingByUpc.set(upc, item);
            if (!productsByUpc.has(upc) && !newUpcSet.has(upc)) {
                newUpcSet.add(upc);
                newUpcs.push(upc);
            }
        }

        if (newUpcs.length) {
            const detailArgs = { upcs: newUpcs, locationId, headers: apiHeaders };
            const details = await fetchProductDetails(undefined, detailArgs);
            const missingUpcs = newUpcs.filter((upc) => !details.has(upc));
            if (missingUpcs.length && proxyUrl) {
                const proxyDetails = await fetchProductDetails(proxyUrl, { ...detailArgs, upcs: missingUpcs });
                for (const [upc, product] of proxyDetails) details.set(upc, product);
            }
            for (const upc of newUpcs) {
                const product = details.get(upc);
                if (product) productsByUpc.set(upc, product);
            }
            log.info(`Extended with ${newUpcs.length} products from the search API.`);
        } else if (!apiListing.length) {
            log.warning(
                `Kroger is limiting full-catalog paging right now, so only the ${productsByUpc.size} products from the search page are available.`,
            );
        }
    }

    const listingMetadata = buildApiListingMetadata(totalCount, sort);
    const orderedUpcs = [...productsByUpc.keys()];
    for (const upc of listingByUpc.keys()) {
        if (!productsByUpc.has(upc)) orderedUpcs.push(upc);
    }

    const batch = [];
    for (const upc of orderedUpcs) {
        if (batch.length >= targetResults) break;
        batch.push(mapRecord(productsByUpc.get(upc), listingByUpc.get(upc), sourceUrl, locationId, listingMetadata));
    }

    if (batch.length) await Actor.pushData(batch);

    const detailCoverage = batch.filter((record) => record.product_data).length;
    let stopReason = 'result limit reached';
    if (batch.length < targetResults) {
        stopReason = apiExtensionAttempted ? 'search page coverage (API unavailable)' : 'source exhausted';
    }
    log.info(
        `Finished | saved=${batch.length}/${targetResults} | with_details=${detailCoverage} | total_available=${totalCount} | stop_reason=${stopReason}`,
    );
}

async function resolveProxyUrl(proxyConfiguration) {
    const effective =
        proxyConfiguration === undefined
            ? { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] }
            : proxyConfiguration;
    if (Actor.isAtHome() && (effective?.useApifyProxy || effective?.proxyUrls?.length)) {
        const proxyConf = await Actor.createProxyConfiguration({ ...effective });
        const proxyUrl = await proxyConf.newUrl();
        const proxyGroup = effective?.apifyProxyGroups?.join(',') || 'configured';
        log.info(`Using Apify ${proxyGroup} proxy for Kroger requests.`);
        return proxyUrl;
    }
    if (effective?.useApifyProxy && !Actor.isAtHome()) {
        log.info('Apify Proxy requested, but local execution is not running on Apify; continuing without proxy.');
    }
    return undefined;
}

let actorError;

try {
    await main();
} catch (error) {
    actorError = error;
    log.error(`Actor failed: ${error.message}`);
}

if (actorError) {
    await Actor.fail(actorError);
} else {
    await Actor.exit();
}
