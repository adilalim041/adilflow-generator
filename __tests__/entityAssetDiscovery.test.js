import { describe, it, expect, vi } from 'vitest';
import discovery from '../lib/entityAssetDiscovery.js';

const {
    selectMentionedEntity,
    getTrustedLogoCandidates,
    assertTrustedLogoUrl,
    resolveEntityLogoAsset
} = discovery;

describe('entity asset discovery', () => {
    it('selects a mentioned company entity from article text', () => {
        const entity = selectMentionedEntity(
            { raw_title: 'OpenAI launches new Codex features for developers' },
            [
                { slug: 'anthropic', name: 'Anthropic', entity_type: 'company', aliases: ['Claude'] },
                { slug: 'openai', name: 'OpenAI', entity_type: 'company', aliases: ['ChatGPT'] }
            ]
        );

        expect(entity.slug).toBe('openai');
    });

    it('rejects untrusted logo candidate hosts', () => {
        expect(() => assertTrustedLogoUrl('https://cdn.simpleicons.org/google/000000')).not.toThrow();
        expect(() => assertTrustedLogoUrl('http://cdn.simpleicons.org/google/000000')).toThrow('https');
        expect(() => assertTrustedLogoUrl('https://example.com/logo.svg')).toThrow('not allowlisted');
    });

    it('returns trusted candidates only for known seeded brands', () => {
        expect(getTrustedLogoCandidates('anthropic')).toHaveLength(1);
        expect(getTrustedLogoCandidates('xai')).toEqual([]);
    });

    it('uses cached approved logo assets without downloading', async () => {
        const brainFetch = vi.fn(async (path) => {
            if (path.startsWith('/api/entities')) {
                return {
                    entities: [
                        { slug: 'openai', name: 'OpenAI', entity_type: 'company', aliases: ['ChatGPT'] }
                    ]
                };
            }
            if (path.startsWith('/api/entity-assets')) {
                return {
                    assets: [
                        {
                            id: 1,
                            entity_slug: 'openai',
                            asset_type: 'logo_icon',
                            status: 'approved',
                            cloudinary_url: 'https://res.cloudinary.com/demo/image/upload/openai.svg'
                        }
                    ]
                };
            }
            throw new Error(`Unexpected path ${path}`);
        });
        const uploadBuffer = vi.fn();
        const fetchImpl = vi.fn();

        const result = await resolveEntityLogoAsset({
            article: { id: 10, raw_title: 'OpenAI releases a new API feature' },
            brainFetch,
            uploadBuffer,
            fetchImpl,
            logger: { warn: vi.fn() }
        });

        expect(result.source).toBe('cache');
        expect(result.entity.slug).toBe('openai');
        expect(result.asset.cloudinary_url).toContain('cloudinary');
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(uploadBuffer).not.toHaveBeenCalled();
    });
});
