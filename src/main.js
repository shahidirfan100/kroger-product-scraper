import { Actor, log } from 'apify';
import { Impit } from 'impit';

const SEARCH_PAGE_SIZE = 24;
const DETAIL_BATCH_SIZE = 20;
const DEFAULT_LOCATION_ID = '02100537';
const DEFAULT_FACILITY_ID = '4000';
const DEFAULT_ASSORTMENT_KEY = '5b3c218b-e8ae-490b-8fd5-9dd2d7bcae6f';
const DEFAULT_FULFILLMENT_METHODS = ['IN_STORE', 'PICKUP', 'DELIVERY'];
const KROGER_HOST_SUFFIX = '.kroger.com';

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

function getApiOrigin(pageUrl) {
    return pageUrl.hostname.toLowerCase() === 'kroger.com' ? 'https://www.kroger.com' : pageUrl.origin;
}

function extractUpcFromProductUrl(pageUrl) {
    const match = pageUrl.pathname.match(/(?:^|\/)(\d{12,14})\/?$/);
    if (!match || !/\/p\//i.test(pageUrl.pathname)) return undefined;
    return match[1];
}

function getUrlQuery(pageUrl) {
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

function buildSearchUrl({ apiOrigin, keyword, locationId, offset, pageSize, sort, fulfillmentMethods }) {
    const url = new URL('/atlas/v1/search/v1/products-search', apiOrigin);
    url.searchParams.set('option.groupBy', 'PRODUCT_VARIANT');
    url.searchParams.set('option.quickFacets', 'true');
    url.searchParams.set('filter.locationId', locationId);
    url.searchParams.set('filter.query', keyword);
    for (const method of fulfillmentMethods) url.searchParams.append('filter.fulfillmentMethods', method);
    url.searchParams.set('page.offset', String(offset));
    url.searchParams.set('page.size', String(pageSize));
    url.searchParams.set('option.personalization', 'PURCHASE_HISTORY');
    url.searchParams.set('sortCriteria', sort.criteria);
    url.searchParams.set('sortOrder', sort.order);
    return url.href;
}

function buildDetailsUrl({ apiOrigin, upcs }) {
    const url = new URL('/atlas/v1/product/v2/products', apiOrigin);
    for (const upc of upcs) url.searchParams.append('filter.gtin13s', upc);
    url.searchParams.set('filter.verified', 'true');
    url.searchParams.set(
        'projections',
        'items.full,offers.compact,nutrition.label,inventory.projected,variantGroupings.compact',
    );
    return url.href;
}

function buildLafObject(locationId) {
    return JSON.stringify([
        {
            modality: {
                type: 'PICKUP',
                handoffLocation: { storeId: locationId, facilityId: DEFAULT_FACILITY_ID },
            },
            sources: [{ storeId: locationId, facilityId: DEFAULT_FACILITY_ID }],
            assortmentKeys: [DEFAULT_ASSORTMENT_KEY],
            listingKeys: [locationId],
        },
    ]);
}

async function fetchJson(client, url, headers, label) {
    const maxAttempts = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await client.fetch(url, { headers });
            if (response.ok) return await response.json();

            const retryable = response.status === 403 || response.status === 429 || response.status >= 500;
            const body = await response.text().catch(() => '');
            const detail = body.replace(/\s+/g, ' ').slice(0, 180);
            lastError = new Error(`${label} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);

            if (!retryable || attempt === maxAttempts) throw lastError;
            const delay = attempt * 1000 + Math.round(Math.random() * 500);
            log.warning(`${label} retry ${attempt}/${maxAttempts} after HTTP ${response.status}`);
            await sleep(delay);
        } catch (error) {
            lastError = error;
            if (/^.* returned HTTP (?!403|429|5\d\d)/.test(error.message)) throw error;
            if (attempt === maxAttempts) throw error;
            const delay = attempt * 1000 + Math.round(Math.random() * 500);
            log.warning(`${label} retry ${attempt}/${maxAttempts}: ${error.message}`);
            await sleep(delay);
        }
    }

    throw lastError || new Error(`${label} failed`);
}

function chunk(values, size) {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
    return chunks;
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
    const availability = product?.inventorySummaries?.[0];

    return cleanValue({
        product_id: item.upc || product.id || searchItem?.upc,
        upc: item.upc || product.id || searchItem?.upc,
        name: item.description || searchItem?.description,
        brand: item.brand?.name,
        size: item.customerFacingSize,
        category: item.categories?.map((category) => category.name).filter(isNonEmpty),
        department: item.familyTree?.department?.name,
        subcategory: item.familyTree?.subCommodity?.name,
        product_description: stripHtml(item.romanceDescription),
        description_html: item.romanceDescription,
        ingredients: product?.nutrition?.ingredients,
        allergens: product?.nutrition?.allergens,
        product_warning: product?.nutrition?.productWarning,
        country_of_origin: item.countriesOfOrigin,
        organic: item.organicClaimName === 'YES' || item.organic === true,
        gluten_free: item.glutenFree === true || item.glutenFreeClaimName?.toLowerCase().includes('gluten free'),
        regular_price: regularPriceValue,
        sale_price: promoPriceValue,
        price_display: regularPrice?.defaultDescription,
        sale_price_display: promoPrice?.defaultDescription,
        unit_price: regularPrice?.equivalizedUnitPriceString,
        currency: regularPrice?.price?.match(/[A-Z]{3}/)?.[0] || promoPrice?.price?.match(/[A-Z]{3}/)?.[0],
        availability: availability?.details?.[0]?.availableToSell > 0 ? 'IN_STOCK' : availability?.stockLevel,
        stock_level: firstInventory?.stockLevel || availability?.stockLevel,
        quantity_available: firstInventory?.available || availability?.availableToSell,
        fulfillment_options: product?.fulfillmentOptions,
        rating: aggregate.averageRating,
        reviews_count: aggregate.numberOfReviews,
        image_url: frontImage,
        image_urls: images,
        aisle: firstLocation?.aisle?.description,
        aisle_number: firstLocation?.aisle?.number,
        aisle_side: firstLocation?.aisle?.side,
        bay: firstLocation?.bayInAisle,
        shelf_position: firstLocation?.shelfPositionInBay,
        product_url: item.shareLink,
        search_rank: searchItem?.searchEngineRank,
        relevance_score: searchItem?.relevanceScore,
        sponsored: Boolean(searchItem?.placementId),
        location_id: locationId,
        source_url: sourceUrl,
        scraped_at: new Date().toISOString(),
        nutrition: mapNutrition(product),
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
    const parsedKeyword = pageUrl ? getUrlQuery(pageUrl) : undefined;
    const effectiveKeyword = String(parsedKeyword || keyword || '').trim();
    const effectiveLocationId = DEFAULT_LOCATION_ID;
    const sourceUrl = pageUrl?.href || `https://www.kroger.com/search?query=${encodeURIComponent(effectiveKeyword)}`;
    const apiOrigin = getApiOrigin(pageUrl || new URL('https://www.kroger.com'));
    const sort = resolveSort(pageUrl?.searchParams.has('sortCriteria') ? undefined : sortBy, pageUrl);
    const methods = DEFAULT_FULFILLMENT_METHODS;
    const lafHeader = buildLafObject(effectiveLocationId);

    if (!effectiveKeyword && !extractUpcFromProductUrl(pageUrl || new URL('https://www.kroger.com'))) {
        throw new Error('Provide either keyword or a Kroger search/product startUrl.');
    }

    let proxyUrl;
    if (Actor.isAtHome() && (proxyConfiguration?.useApifyProxy || proxyConfiguration?.proxyUrls?.length)) {
        const proxyConf = await Actor.createProxyConfiguration({ ...proxyConfiguration });
        proxyUrl = await proxyConf.newUrl();
    } else if (proxyConfiguration?.useApifyProxy) {
        log.info('Apify Proxy requested, but local execution is not running on Apify; continuing without proxy.');
    }

    const client = new Impit({
        browser: 'chrome',
        vanillaFallback: true,
        timeout: 30000,
        ignoreTlsErrors: true,
        ...(proxyUrl ? { proxyUrl } : { http3: true }),
    });
    const requestHeaders = {
        'x-laf-object': lafHeader,
        'x-kroger-channel': 'WEB',
        referer: sourceUrl,
    };
    const productUrlUpc = extractUpcFromProductUrl(pageUrl || new URL('https://www.kroger.com'));
    const seenUpcs = new Set();
    let saved = 0;
    let pagesProcessed = 0;
    let stopReason = 'result limit reached';

    log.info(
        `Starting Kroger product run | keyword=${effectiveKeyword || '(product URL)'} | results=${resultsWanted} | max_pages=${maxPages}`,
    );

    if (productUrlUpc) {
        const detailsUrl = buildDetailsUrl({ apiOrigin, upcs: [productUrlUpc] });
        const details = await fetchJson(client, detailsUrl, requestHeaders, 'Product details');
        const product = details?.data?.products?.[0];
        if (product) {
            const item = mapProduct(product, { upc: productUrlUpc }, sourceUrl, effectiveLocationId);
            await Actor.pushData(item);
            saved = 1;
        }
        log.info(`Finished | saved=${saved} | pages=0 | stop_reason=product URL processed`);
        return;
    }

    for (let pageNumber = 1; pageNumber <= maxPages && saved < resultsWanted; pageNumber++) {
        const offset = (pageNumber - 1) * SEARCH_PAGE_SIZE;
        const searchUrl = buildSearchUrl({
            apiOrigin,
            keyword: effectiveKeyword,
            locationId: effectiveLocationId,
            offset,
            pageSize: SEARCH_PAGE_SIZE,
            sort,
            fulfillmentMethods: methods,
        });
        const searchData = await fetchJson(client, searchUrl, requestHeaders, `Search page ${pageNumber}`);
        const searchItems = searchData?.data?.productsSearch;
        if (!Array.isArray(searchItems)) {
            throw new Error(`Search page ${pageNumber} did not contain data.productsSearch.`);
        }

        pagesProcessed = pageNumber;
        const pageUpcs = searchItems.map((item) => String(item.upc || '').trim()).filter(Boolean);
        const newUpcs = pageUpcs.filter((upc) => !seenUpcs.has(upc));
        newUpcs.forEach((upc) => seenUpcs.add(upc));

        if (!newUpcs.length) {
            stopReason = 'no new products';
            break;
        }

        const detailMap = new Map();
        for (const upcBatch of chunk(newUpcs, DETAIL_BATCH_SIZE)) {
            const detailsUrl = buildDetailsUrl({ apiOrigin, upcs: upcBatch });
            const details = await fetchJson(client, detailsUrl, requestHeaders, `Product details page ${pageNumber}`);
            for (const product of details?.data?.products || []) {
                const productId = String(product?.item?.upc || product?.id || '').trim();
                if (productId) detailMap.set(productId, product);
            }
        }

        const batch = [];
        for (const searchItem of searchItems) {
            if (saved + batch.length >= resultsWanted) break;
            const upc = String(searchItem.upc || '').trim();
            const product = detailMap.get(upc);
            if (!product) continue;
            batch.push(mapProduct(product, searchItem, sourceUrl, effectiveLocationId));
        }

        if (batch.length) {
            await Actor.pushData(batch);
            saved += batch.length;
            log.info(`Saved ${batch.length} products | total=${saved}/${resultsWanted} | page=${pageNumber}`);
        }

        const totalCount = Number(searchData?.meta?.productsSearch?.totalCount || 0);
        const noMorePages = !searchItems.length || (totalCount > 0 && offset + SEARCH_PAGE_SIZE >= totalCount);
        if (noMorePages) {
            stopReason = 'source exhausted';
            break;
        }
        if (!batch.length && pageNumber === maxPages) stopReason = 'page limit reached';
    }

    if (saved >= resultsWanted) stopReason = 'result limit reached';
    else if (pagesProcessed >= maxPages) stopReason = 'page limit reached';
    log.info(`Finished | saved=${saved} | pages=${pagesProcessed} | stop_reason=${stopReason}`);
}

try {
    await main();
} catch (error) {
    log.error(`Actor failed: ${error.message}`);
    throw error;
} finally {
    await Actor.exit();
}
