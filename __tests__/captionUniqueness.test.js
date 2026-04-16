/**
 * Tests for lib/captionUniqueness.js
 *
 * Uses Vitest with CJS interop — the lib uses module.exports,
 * vitest handles the CJS→ESM interop automatically.
 */

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

// Load CJS module via createRequire (safe in vitest ESM context)
const require = createRequire(import.meta.url);
const { checkCaptionUniqueness, nextAngle, ANGLE_ROTATION } = require('../lib/captionUniqueness.js');

// ─── nextAngle ────────────────────────────────────────────────────────────────

describe('nextAngle', () => {
    it('rotates shock → useful', () => {
        expect(nextAngle('shock')).toBe('useful');
    });

    it('rotates useful → breakthrough', () => {
        expect(nextAngle('useful')).toBe('breakthrough');
    });

    it('rotates breakthrough → explain', () => {
        expect(nextAngle('breakthrough')).toBe('explain');
    });

    it('rotates explain → shock (full cycle)', () => {
        expect(nextAngle('explain')).toBe('shock');
    });

    it('falls back to explain for unknown angle', () => {
        expect(nextAngle('unknown')).toBe('explain');
        expect(nextAngle('')).toBe('explain');
        expect(nextAngle(null)).toBe('explain');
        expect(nextAngle(undefined)).toBe('explain');
    });

    it('ANGLE_ROTATION covers all 4 known angles', () => {
        expect(Object.keys(ANGLE_ROTATION)).toHaveLength(4);
    });
});

// ─── checkCaptionUniqueness ───────────────────────────────────────────────────

describe('checkCaptionUniqueness — 200 unique:true', () => {
    it('returns unique:true from brain', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ unique: true, closest_similarity: 0.45 })
        });

        const result = await checkCaptionUniqueness('Some caption text', 42, {
            brainUrl: 'http://brain-test',
            brainApiKey: 'test-key',
            fetchFn: mockFetch
        });

        expect(result.unique).toBe(true);
        expect(result.check_failed).toBeUndefined();
        expect(result.closest_similarity).toBe(0.45);
        expect(mockFetch).toHaveBeenCalledOnce();

        const callArgs = mockFetch.mock.calls[0];
        expect(callArgs[0]).toBe('http://brain-test/api/captions/check-similarity');
        const reqBody = JSON.parse(callArgs[1].body);
        expect(reqBody.caption).toBe('Some caption text');
        expect(reqBody.exclude_article_id).toBe(42);
    });
});

describe('checkCaptionUniqueness — 200 unique:false (duplicate)', () => {
    it('returns full non-unique payload', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                unique: false,
                similarity: 0.95,
                matched_article_id: 7,
                matched_niche: 'ai_news',
                matched_caption_preview: 'OpenAI released...'
            })
        });

        const result = await checkCaptionUniqueness('Some duplicate caption', 99, {
            brainUrl: 'http://brain-test',
            brainApiKey: 'test-key',
            fetchFn: mockFetch
        });

        expect(result.unique).toBe(false);
        expect(result.similarity).toBe(0.95);
        expect(result.matched_article_id).toBe(7);
        expect(result.matched_niche).toBe('ai_news');
        expect(result.check_failed).toBeUndefined();
    });
});

describe('checkCaptionUniqueness — 5xx fallback', () => {
    it('returns unique:true + check_failed:true on 500', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal server error' })
        });

        const result = await checkCaptionUniqueness('Caption text', 1, {
            brainUrl: 'http://brain-test',
            brainApiKey: 'key',
            fetchFn: mockFetch
        });

        expect(result.unique).toBe(true);
        expect(result.check_failed).toBe(true);
        // 5xx should NOT retry (returns immediately)
        expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('returns unique:true + check_failed:true on 503', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 503,
            json: async () => ({})
        });

        const result = await checkCaptionUniqueness('Caption text', 1, {
            brainUrl: 'http://brain-test',
            brainApiKey: 'key',
            fetchFn: mockFetch
        });

        expect(result.unique).toBe(true);
        expect(result.check_failed).toBe(true);
    });
});

describe('checkCaptionUniqueness — timeout fallback', () => {
    it('returns unique:true + check_failed:true when fetch throws AbortError (simulated timeout)', async () => {
        // Provide a fetchFn that throws AbortError immediately (simulates 5s timeout firing)
        const abortFetch = vi.fn().mockRejectedValue(
            Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
        );

        const result = await checkCaptionUniqueness('Caption text', 1, {
            brainUrl: 'http://brain-test',
            brainApiKey: 'key',
            fetchFn: abortFetch
        });

        expect(result.unique).toBe(true);
        expect(result.check_failed).toBe(true);
        // Should retry once then give up (2 attempts total)
        expect(abortFetch).toHaveBeenCalledTimes(2);
    });
});

describe('checkCaptionUniqueness — network error fallback', () => {
    it('returns unique:true + check_failed:true on network failure', async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

        const result = await checkCaptionUniqueness('Caption text', 5, {
            brainUrl: 'http://brain-test',
            brainApiKey: 'key',
            fetchFn: mockFetch
        });

        expect(result.unique).toBe(true);
        expect(result.check_failed).toBe(true);
        // 2 attempts before giving up
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('succeeds on second attempt after transient failure', async () => {
        let callCount = 0;
        const mockFetch = vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) throw new Error('Transient network glitch');
            return {
                ok: true,
                status: 200,
                json: async () => ({ unique: true })
            };
        });

        const result = await checkCaptionUniqueness('Caption text', 5, {
            brainUrl: 'http://brain-test',
            brainApiKey: 'key',
            fetchFn: mockFetch
        });

        expect(result.unique).toBe(true);
        expect(result.check_failed).toBeUndefined();
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });
});

describe('checkCaptionUniqueness — 4xx fallback', () => {
    it('returns unique:true + check_failed:true on 4xx (non-5xx non-ok)', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 422,
            json: async () => ({ error: 'Missing caption' })
        });

        const result = await checkCaptionUniqueness('', null, {
            brainUrl: 'http://brain-test',
            brainApiKey: 'key',
            fetchFn: mockFetch
        });

        expect(result.unique).toBe(true);
        expect(result.check_failed).toBe(true);
    });
});

describe('checkCaptionUniqueness — authorization header', () => {
    it('sends Bearer token in Authorization header', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ unique: true })
        });

        await checkCaptionUniqueness('test', 1, {
            brainUrl: 'http://brain-test',
            brainApiKey: 'my-secret-key',
            fetchFn: mockFetch
        });

        const headers = mockFetch.mock.calls[0][1].headers;
        expect(headers.Authorization).toBe('Bearer my-secret-key');
        expect(headers['Content-Type']).toBe('application/json');
    });
});

describe('checkCaptionUniqueness — embedding_failed graceful', () => {
    it('returns unique:true with embedding_failed flag when brain signals it', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ unique: true, embedding_failed: true })
        });

        const result = await checkCaptionUniqueness('Caption', 10, {
            brainUrl: 'http://brain-test',
            brainApiKey: 'key',
            fetchFn: mockFetch
        });

        expect(result.unique).toBe(true);
        expect(result.embedding_failed).toBe(true);
        // embedding_failed is from brain, not our check_failed — different flag
        expect(result.check_failed).toBeUndefined();
    });
});
