import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Actor, log } from 'apify';
import { Impit } from 'impit';
import { chromium } from 'patchright';

const SEARCH_PAGE_SIZE = 24;

const DEFAULT_LOCATION_ID = '02100537';
const DEFAULT_FACILITY_ID = '4000';
const DEFAULT_ASSORTMENT_KEY = '5b3c218b-e8ae-490b-8fd5-9dd2d7bcae6f';
const DEFAULT_FULFILLMENT_METHODS = ['IN_STORE', 'PICKUP', 'DELIVERY'];

const BROWSER_NAVIGATION_TIMEOUT_MS = 75000;
const BROWSER_REQUEST_TIMEOUT_MS = 30000;

const KROGER_HOST_SUFFIX = '.kroger.com';

let browserSession;

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

function getBrowserProxyOptions(proxyUrl) {
    if (!proxyUrl) return undefined;

    const parsed = new URL(proxyUrl);
    const proxy = { server: `${parsed.protocol}//${parsed.host}` };
    if (parsed.username) proxy.username = decodeURIComponent(parsed.username);
    if (parsed.password) proxy.password = decodeURIComponent(parsed.password);
    return proxy;
}

function isChallengeHttpError(error) {
    return /\bHTTP (?:403|429)\b/.test(error?.message || '');
}

function isServerHttpError(error) {
    return /\bHTTP 5\d\d\b/.test(error?.message || '');
}

function isTransportError(error) {
    return /internal HTTP library|request timeout|timed out|ECONNRESET|connection reset|connection closed|network error|proxy error/i.test(
        error?.message || '',
    );
}

function isUnexpectedJsonError(error) {
    return /invalid JSON|non-JSON|challenge response/i.test(error?.message || '');
}

async function fetchJson(client, url, headers, label) {
    const maxAttempts = 2;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await client.fetch(url, { headers });
            const body = await response.text().catch(() => '');
            if (response.ok) {
                try {
                    return JSON.parse(body);
                } catch {
                    throw new Error(`${label} returned a non-JSON challenge response.`);
                }
            }

            const detail = body.replace(/\s+/g, ' ').slice(0, 180);
            lastError = new Error(`${label} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);

            if (isChallengeHttpError(lastError) || response.status < 500 || attempt === maxAttempts) {
                throw lastError;
            }

            const delay = attempt * 1000 + Math.round(Math.random() * 500);
            log.warning(`${label} retry ${attempt}/${maxAttempts} after HTTP ${response.status}`);
            await sleep(delay);
        } catch (error) {
            lastError = error;
            if (
                isChallengeHttpError(error) ||
                isTransportError(error) ||
                isUnexpectedJsonError(error) ||
                !isServerHttpError(error) ||
                attempt === maxAttempts
            ) {
                throw error;
            }

            const delay = attempt * 1000 + Math.round(Math.random() * 500);
            log.warning(`${label} retry ${attempt}/${maxAttempts}: ${error.message}`);
            await sleep(delay);
        }
    }

    throw lastError || new Error(`${label} failed`);
}

function isBrowserChallengeError(error) {
    return (
        isChallengeHttpError(error) ||
        isServerHttpError(error) ||
        isTransportError(error) ||
        isUnexpectedJsonError(error)
    );
}

async function createBrowserSession(sourceUrl, proxyUrl, attempt) {
    const browserProxy = getBrowserProxyOptions(proxyUrl);
    log.info(`Opening Chrome fallback${browserProxy ? ' through Apify Proxy' : ''} (attempt ${attempt}).`);
    const browserContext = await chromium.launchPersistentContext(
        join(tmpdir(), `kroger-product-scraper-${process.pid}-${attempt}`),
        {
            channel: 'chrome',
            headless: false,
            noViewport: true,
            ignoreHTTPSErrors: true,
            ...(browserProxy ? { proxy: browserProxy } : {}),
        },
    );
    const page = browserContext.pages()[0] || (await browserContext.newPage());

    try {
        let navigationError;
        try {
            await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: BROWSER_NAVIGATION_TIMEOUT_MS });
        } catch (error) {
            navigationError = error;
            log.warning(`Kroger page navigation did not finish cleanly: ${error.message}`);
        }

        if (page.url() === 'about:blank') {
            throw navigationError || new Error('Kroger browser navigation did not open a page.');
        }

        // Let Akamai's browser challenge and the listing application finish. The
        // API request is made after this step, so a missing/late page XHR cannot
        // make the actor fail during bootstrap.
        await page
            .waitForFunction(
                () => {
                    const text = document.body?.innerText || '';
                    return (
                        document.querySelectorAll('a[href*="/p/"]').length > 0 ||
                        /search products|products loaded|search:/i.test(text)
                    );
                },
                { timeout: 30000 },
            )
            .catch(() =>
                log.warning('Kroger listing UI was not ready; trying the listing API from the browser anyway.'),
            );
        await page.waitForTimeout(1500);

        return {
            page,
            close: () => browserContext.close(),
        };
    } catch (error) {
        await browserContext.close();
        throw error;
    }
}

async function fetchJsonInBrowser(
    page,
    url,
    headers,
    label,
    requestTimeoutMs = BROWSER_REQUEST_TIMEOUT_MS,
    maxAttempts = 2,
) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let result;
        try {
            result = await page.evaluate(
                async ({ requestUrl, requestHeaders, requestTimeoutMs: timeoutMs }) => {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
                    try {
                        const response = await fetch(requestUrl, {
                            credentials: 'include',
                            headers: requestHeaders,
                            signal: controller.signal,
                        });
                        return {
                            status: response.status,
                            body: await response.text(),
                        };
                    } finally {
                        clearTimeout(timeoutId);
                    }
                },
                { requestUrl: url, requestHeaders: headers, requestTimeoutMs },
            );
        } catch (error) {
            lastError = error;
            if (attempt === maxAttempts) throw error;
            const delay = attempt * 1000 + Math.round(Math.random() * 500);
            log.warning(`${label} browser retry ${attempt}/${maxAttempts}: ${error.message}`);
            await sleep(delay);
            continue;
        }

        if (result.status >= 200 && result.status < 300) {
            try {
                return JSON.parse(result.body);
            } catch {
                throw new Error(`${label} returned invalid JSON from the browser session.`);
            }
        }

        const detail = result.body.replace(/\s+/g, ' ').slice(0, 180);
        lastError = new Error(`${label} returned HTTP ${result.status}${detail ? `: ${detail}` : ''}`);
        const retryable = result.status === 403 || result.status === 429 || result.status >= 500;
        if (!retryable || attempt === maxAttempts) throw lastError;

        const delay = attempt * 1000 + Math.round(Math.random() * 500);
        log.warning(`${label} browser retry ${attempt}/${maxAttempts} after HTTP ${result.status}`);
        await sleep(delay);
    }

    throw lastError || new Error(`${label} failed in the browser session.`);
}

async function fetchJsonWithDirectFallback(client, directClient, url, headers, label) {
    try {
        return await fetchJson(client, url, headers, label);
    } catch (error) {
        if (directClient === client || !isBrowserChallengeError(error)) throw error;

        log.warning(`${label} was blocked through Apify Proxy; retrying with direct Impit.`);
        return fetchJson(directClient, url, headers, label);
    }
}

async function fetchJsonBrowserFirst(client, directClient, url, headers, label, sourceUrl) {
    let lastBrowserError;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            if (!browserSession) {
                browserSession = await createBrowserSession(sourceUrl, undefined, attempt);
            }
            return await fetchJsonInBrowser(browserSession.page, url, headers, label);
        } catch (error) {
            lastBrowserError = error;
            await browserSession?.close();
            browserSession = undefined;
            if (attempt < 2) {
                log.warning(`${label} Patchright session failed; retrying browser bootstrap.`);
            }
        }
    }

    log.warning(
        `${label} could not be fetched with Patchright; trying the configured residential/direct HTTP fallback.`,
    );
    try {
        return await fetchJsonWithDirectFallback(client, directClient, url, headers, label);
    } catch (error) {
        if (lastBrowserError && isBrowserChallengeError(lastBrowserError)) throw error;
        throw lastBrowserError || error;
    }
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
        brand: typeof item.brand === 'string' ? item.brand : item.brand?.name,
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

function mapSearchProduct(searchItem, sourceUrl, locationId, listingMetadata) {
    const candidate = searchItem?.product || searchItem;
    const sourceItem = candidate?.item || searchItem?.item;
    const item = {
        ...(sourceItem || candidate || {}),
        upc: sourceItem?.upc || candidate?.upc || searchItem?.upc,
        description: sourceItem?.description || candidate?.description || searchItem?.description,
        brand: sourceItem?.brand || candidate?.brand || searchItem?.brandName,
    };
    const product = {
        ...searchItem,
        ...candidate,
        item,
        id: candidate?.id || searchItem?.id || item.upc,
    };
    const mapped = mapProduct(product, searchItem, sourceUrl, locationId);
    return cleanValue({
        ...mapped,
        group_id: searchItem?.groupedBy && searchItem.groupedBy !== 'NONE' ? searchItem.groupedBy : undefined,
        sub_commodity_codes: searchItem?.subCommodityCode,
        personalized: searchItem?.personalized,
        placement_id: searchItem?.placementId,
        listing_data: searchItem,
        listing_metadata: listingMetadata,
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
    const productUrlUpc = extractUpcFromProductUrl(pageUrl || new URL('https://www.kroger.com'));
    const parsedKeyword = pageUrl ? getUrlQuery(pageUrl) : undefined;
    const effectiveKeyword =
        productUrlUpc || (pageUrl ? String(parsedKeyword || '').trim() : String(keyword || '').trim());
    const effectiveLocationId = DEFAULT_LOCATION_ID;
    const sourceUrl =
        pageUrl?.href ||
        `https://www.kroger.com/search?query=${encodeURIComponent(effectiveKeyword)}&searchType=default_search`;
    const listingSourceUrl = productUrlUpc
        ? `https://www.kroger.com/search?query=${encodeURIComponent(productUrlUpc)}&searchType=default_search`
        : sourceUrl;
    const apiOrigin = getApiOrigin(pageUrl || new URL('https://www.kroger.com'));
    const sort = resolveSort(pageUrl?.searchParams.has('sortCriteria') ? undefined : sortBy, pageUrl);
    const methods = DEFAULT_FULFILLMENT_METHODS;
    const lafHeader = buildLafObject(effectiveLocationId);

    if (!effectiveKeyword) {
        throw new Error('Provide either keyword or a Kroger search/product startUrl.');
    }

    const effectiveProxyConfiguration =
        proxyConfiguration === undefined
            ? { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] }
            : proxyConfiguration;
    let proxyUrl;
    let proxyConf;
    if (
        Actor.isAtHome() &&
        (effectiveProxyConfiguration?.useApifyProxy || effectiveProxyConfiguration?.proxyUrls?.length)
    ) {
        proxyConf = await Actor.createProxyConfiguration({ ...effectiveProxyConfiguration });
        proxyUrl = await proxyConf.newUrl();
        const proxyGroup = effectiveProxyConfiguration?.apifyProxyGroups?.join(',') || 'configured';
        log.info(`Using Apify ${proxyGroup} proxy for the Impit HTTP fallback.`);
    } else if (effectiveProxyConfiguration?.useApifyProxy) {
        log.info('Apify Proxy requested, but local execution is not running on Apify; continuing without proxy.');
    }

    const client = new Impit({
        browser: 'chrome',
        ignoreTlsErrors: true,
        timeout: 15000,
        ...(proxyUrl ? { proxyUrl } : {}),
    });
    const directClient = proxyUrl
        ? new Impit({
              browser: 'chrome',
              ignoreTlsErrors: true,
              timeout: 15000,
          })
        : client;
    const requestHeaders = {
        accept: 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'x-laf-object': lafHeader,
        'x-kroger-channel': 'WEB',
        referer: listingSourceUrl,
    };
    const fetchData = (requestUrl, label) =>
        fetchJsonBrowserFirst(client, directClient, requestUrl, requestHeaders, label, listingSourceUrl);
    const targetResults = productUrlUpc ? Math.min(resultsWanted, 1) : resultsWanted;
    const targetPages = productUrlUpc ? 1 : maxPages;
    const seenUpcs = new Set();
    let saved = 0;
    let pagesProcessed = 0;
    let stopReason = 'result limit reached';

    log.info(
        `Starting Kroger product run | keyword=${effectiveKeyword} | results=${targetResults} | max_pages=${targetPages}`,
    );

    for (let pageNumber = 1; pageNumber <= targetPages && saved < targetResults; pageNumber++) {
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
        const searchData = await fetchData(searchUrl, `Search page ${pageNumber}`);
        const searchItems = searchData?.data?.productsSearch;
        if (!Array.isArray(searchItems)) {
            throw new Error(`Search page ${pageNumber} did not contain data.productsSearch.`);
        }

        pagesProcessed = pageNumber;
        const pageUpcs = searchItems.map((item) => String(item.upc || '').trim()).filter(Boolean);
        const remainingResults = Math.max(0, targetResults - saved);
        const newUpcs = pageUpcs.filter((upc) => !seenUpcs.has(upc)).slice(0, remainingResults);
        const newUpcSet = new Set(newUpcs);
        newUpcs.forEach((upc) => seenUpcs.add(upc));

        if (!newUpcs.length) {
            stopReason = 'no new products';
            break;
        }

        const searchMetadata = searchData?.meta?.productsSearch || {};
        const listingMetadata = {
            page: searchMetadata.page,
            total_count: searchMetadata.totalCount,
            available_count: searchMetadata.availableCount,
            sort: searchMetadata.sort,
            search_configuration_id: searchMetadata.searchConfigurationId,
            search_workflow: searchMetadata.searchWorkflow,
        };


        const batch = [];
        for (const searchItem of searchItems) {
            if (saved + batch.length >= targetResults) break;
            const upc = String(searchItem.upc || '').trim();
            if (!newUpcSet.has(upc)) continue;
            batch.push(mapSearchProduct(searchItem, sourceUrl, effectiveLocationId, listingMetadata));
        }

        if (batch.length) {
            await Actor.pushData(batch);
            saved += batch.length;
            log.info(`Saved ${batch.length} products | total=${saved}/${targetResults} | page=${pageNumber}`);
        }

        const totalCount = Number(searchMetadata.totalCount || 0);
        const noMorePages = !searchItems.length || (totalCount > 0 && offset + SEARCH_PAGE_SIZE >= totalCount);
        if (noMorePages) {
            stopReason = 'source exhausted';
            break;
        }
        if (!batch.length && pageNumber === targetPages) stopReason = 'page limit reached';
    }

    if (saved >= targetResults) stopReason = 'result limit reached';
    else if (pagesProcessed >= targetPages) stopReason = 'page limit reached';
    log.info(`Finished | saved=${saved} | pages=${pagesProcessed} | stop_reason=${stopReason}`);
}

let actorError;

try {
    await main();
} catch (error) {
    actorError = error;
    log.error(`Actor failed: ${error.message}`);
} finally {
    await browserSession?.close();
}

if (actorError) {
    await Actor.fail(actorError);
} else {
    await Actor.exit();
}
