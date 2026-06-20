import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { logEvent, buildAuthHeaders, buildEventPayload } = require('../lib/generationEvents');

describe('generationEvents', () => {
    it('builds the Brain payload with snake_case fields', () => {
        const payload = buildEventPayload({
            articleId: '8474',
            kind: 'image_prompt',
            provider: 'openai',
            model: 'gpt-image-2',
            prompt: { prompt: 'hello' },
            response: { image_url: 'https://example.com/image.png', reference_asset_ids: [9] },
            outcome: 'ok',
            latencyMs: 123.8
        });

        expect(payload).toEqual({
            article_id: 8474,
            kind: 'image_prompt',
            provider: 'openai',
            model: 'gpt-image-2',
            prompt: { prompt: 'hello' },
            response: { image_url: 'https://example.com/image.png', reference_asset_ids: [9] },
            outcome: 'ok',
            error: null,
            latency_ms: 124
        });
    });

    it('sends Bearer auth accepted by Brain generation-events endpoint', async () => {
        const fetchFn = vi.fn(async () => ({
            ok: true,
            text: async () => ''
        }));

        await logEvent({
            articleId: 1,
            kind: 'image_prompt',
            provider: 'openai',
            model: 'gpt-image-2',
            prompt: { prompt: 'test' },
            response: { image_url: 'https://example.com/image.png' },
            outcome: 'ok',
            latencyMs: 10
        }, { fetchFn });

        const [, options] = fetchFn.mock.calls[0];
        expect(options.headers.Authorization).toMatch(/^Bearer /);
        expect(options.headers).toHaveProperty('x-api-key');
        expect(JSON.parse(options.body).article_id).toBe(1);
    });

    it('does not throw when Brain rejects the audit event', async () => {
        const warn = vi.fn();
        const fetchFn = vi.fn(async () => ({
            ok: false,
            status: 401,
            text: async () => '{"error":"Unauthorized"}'
        }));

        await expect(logEvent({
            articleId: 1,
            kind: 'image_prompt',
            provider: 'openai',
            prompt: { prompt: 'test' },
            response: null,
            outcome: 'error',
            error: 'test'
        }, { fetchFn, logger: { warn } })).resolves.toBeUndefined();

        expect(warn).toHaveBeenCalled();
    });

    it('exposes auth headers without hardcoding secret values', () => {
        const headers = buildAuthHeaders();
        expect(headers).toHaveProperty('Content-Type', 'application/json');
        expect(headers.Authorization).toMatch(/^Bearer /);
        expect(headers['x-api-key']).toBeDefined();
    });
});
