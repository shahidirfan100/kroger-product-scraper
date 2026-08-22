import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const inputSchema = JSON.parse(readFileSync(new URL('../.actor/input_schema.json', import.meta.url), 'utf8'));
const sampleInput = JSON.parse(readFileSync(new URL('../INPUT.json', import.meta.url), 'utf8'));

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
});
