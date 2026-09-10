import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const inputSchema = JSON.parse(readFileSync(new URL('../.actor/input_schema.json', import.meta.url), 'utf8'));
const sampleInput = JSON.parse(readFileSync(new URL('../INPUT.json', import.meta.url), 'utf8'));
const actorSource = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

const removedOptions = ['locationId', 'fulfillmentMethods', 'lafObject'];

describe('actor input configuration', () => {
    it('does not expose removed store-context options in the schema', () => {
        for (const option of removedOptions) {
            expect(inputSchema.properties).not.toHaveProperty(option);
        }
    });

    it('does not include removed store-context options in the sample input', () => {
        for (const option of removedOptions) {
            expect(sampleInput).not.toHaveProperty(option);
        }
    });

    it('uses one deliberate search mode for the QA and local sample input', () => {
        expect(inputSchema.properties.startUrl.prefill).toContain('kroger.com/search');
        expect(inputSchema.properties.keyword).not.toHaveProperty('prefill');
        expect(sampleInput).toHaveProperty('startUrl');
        expect(sampleInput).not.toHaveProperty('keyword');
    });

    it('defaults cloud runs to the tested Apify Residential group', () => {
        expect(inputSchema.properties.proxyConfiguration.default).toMatchObject({
            useApifyProxy: true,
            apifyProxyGroups: ['RESIDENTIAL'],
        });
    });

    it('uses the listing endpoint without product-detail enrichment', () => {
        expect(actorSource).toContain('/atlas/v1/search/v1/products-search');
        expect(actorSource).not.toContain('/atlas/v1/product/v2/products');
        expect(actorSource).toContain('fetchJsonBrowserFirst');
        expect(actorSource).toContain('listing_data');
        expect(actorSource).not.toContain('product detail requests are disabled');
    });
});
