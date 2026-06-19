import { describe, it, expect, vi } from 'vitest';
import discovery from '../lib/entityAssetDiscovery.js';

const {
    selectMentionedEntity,
    getTrustedLogoCandidates,
    buildWhiteLogoBadgeSvg,
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
        expect(() => assertTrustedLogoUrl('https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/google.svg')).not.toThrow();
        expect(() => assertTrustedLogoUrl('http://cdn.simpleicons.org/google/000000')).toThrow('https');
        expect(() => assertTrustedLogoUrl('https://example.com/logo.svg')).toThrow('not allowlisted');
    });

    it('returns trusted candidates only for known seeded brands', () => {
        expect(getTrustedLogoCandidates('anthropic').length).toBeGreaterThanOrEqual(2);
        expect(getTrustedLogoCandidates('xai')).toEqual([]);
    });

    it('wraps raw logos in a white circular badge svg', () => {
        const rawLogo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M0 0h10v10H0z"/></svg>');
        const badge = buildWhiteLogoBadgeSvg(rawLogo, 'image/svg+xml').toString('utf8');

        expect(badge).toContain('fill="#ffffff"');
        expect(badge).toContain('data:image/svg+xml;base64,');
        expect(badge).toContain('preserveAspectRatio="xMidYMid meet"');
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
                            cloudinary_url: 'https://res.cloudinary.com/demo/image/upload/openai.svg',
                            metadata: { white_badge: true }
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

    it('rebuilds legacy transparent cached logos as white badges', async () => {
        const brainFetch = vi.fn(async (path, options = {}) => {
            if (path.startsWith('/api/entities')) {
                return {
                    entities: [
                        { slug: 'anthropic', name: 'Anthropic', entity_type: 'company', aliases: ['Claude'] }
                    ]
                };
            }
            if (path.startsWith('/api/entity-assets') && options.method !== 'POST') {
                return {
                    assets: [
                        {
                            id: 1,
                            entity_slug: 'anthropic',
                            asset_type: 'logo_icon',
                            status: 'approved',
                            cloudinary_url: 'https://res.cloudinary.com/demo/image/upload/transparent.svg',
                            metadata: { white_badge: false }
                        }
                    ]
                };
            }
            if (path === '/api/entity-assets' && options.method === 'POST') {
                return {
                    asset: {
                        id: 1,
                        entity_slug: 'anthropic',
                        asset_type: 'logo_icon',
                        status: 'approved',
                        cloudinary_url: 'https://res.cloudinary.com/demo/image/upload/anthropic-badge.svg',
                        metadata: JSON.parse(options.body).metadata
                    }
                };
            }
            throw new Error(`Unexpected path ${path}`);
        });
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            url: 'https://cdn.simpleicons.org/anthropic/000000',
            headers: new Map([['content-type', 'image/svg+xml'], ['content-length', '120']]),
            arrayBuffer: async () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z"/></svg>').buffer
        }));
        const uploadBuffer = vi.fn(async (buffer, options) => {
            expect(options.mimeType).toBe('image/svg+xml');
            expect(buffer.toString('utf8')).toContain('fill="#ffffff"');
            return 'https://res.cloudinary.com/demo/image/upload/anthropic-badge.svg';
        });

        const result = await resolveEntityLogoAsset({
            article: { id: 11, raw_title: 'Anthropic releases new Claude model' },
            brainFetch,
            uploadBuffer,
            fetchImpl,
            logger: { warn: vi.fn() }
        });

        expect(result.source).toBe('discovered');
        expect(result.asset.metadata.white_badge).toBe(true);
        expect(fetchImpl).toHaveBeenCalled();
        expect(uploadBuffer).toHaveBeenCalled();
    });

    it('tries the next trusted logo candidate when the first one fails', async () => {
        const brainFetch = vi.fn(async (path, options = {}) => {
            if (path.startsWith('/api/entities')) {
                return {
                    entities: [
                        { slug: 'meta', name: 'Meta', entity_type: 'company', aliases: ['Facebook'] }
                    ]
                };
            }
            if (path.startsWith('/api/entity-assets') && options.method !== 'POST') {
                return { assets: [] };
            }
            if (path === '/api/entity-assets' && options.method === 'POST') {
                return {
                    asset: {
                        id: 4,
                        entity_slug: 'meta',
                        asset_type: 'logo_icon',
                        status: 'approved',
                        cloudinary_url: 'https://res.cloudinary.com/demo/image/upload/meta-badge.svg',
                        metadata: JSON.parse(options.body).metadata
                    }
                };
            }
            throw new Error(`Unexpected path ${path}`);
        });
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 403,
                url: 'https://cdn.simpleicons.org/meta/000000',
                headers: new Map()
            })
            .mockResolvedValueOnce({
                ok: true,
                url: 'https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/meta.svg',
                headers: new Map([['content-type', 'image/svg+xml'], ['content-length', '120']]),
                arrayBuffer: async () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z"/></svg>').buffer
            });
        const uploadBuffer = vi.fn(async () => 'https://res.cloudinary.com/demo/image/upload/meta-badge.svg');
        const logger = { warn: vi.fn() };

        const result = await resolveEntityLogoAsset({
            article: { id: 13, raw_title: 'Meta Superintelligence Labs ships a new model' },
            brainFetch,
            uploadBuffer,
            fetchImpl,
            logger
        });

        expect(result.source).toBe('discovered');
        expect(result.entity.slug).toBe('meta');
        expect(result.asset.metadata.original_candidate_url).toContain('cdn.jsdelivr.net');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledWith(expect.any(Object), 'Logo candidate failed');
    });

    it('keeps a legacy cached logo when no trusted candidate exists', async () => {
        const brainFetch = vi.fn(async (path) => {
            if (path.startsWith('/api/entities')) {
                return {
                    entities: [
                        { slug: 'xai', name: 'xAI', entity_type: 'company', aliases: ['Grok'] }
                    ]
                };
            }
            if (path.startsWith('/api/entity-assets')) {
                return {
                    assets: [
                        {
                            id: 3,
                            entity_slug: 'xai',
                            asset_type: 'logo_icon',
                            status: 'approved',
                            cloudinary_url: 'https://res.cloudinary.com/demo/image/upload/xai.svg',
                            metadata: {}
                        }
                    ]
                };
            }
            throw new Error(`Unexpected path ${path}`);
        });
        const uploadBuffer = vi.fn();
        const fetchImpl = vi.fn();

        const result = await resolveEntityLogoAsset({
            article: { id: 12, raw_title: 'xAI releases a new Grok model' },
            brainFetch,
            uploadBuffer,
            fetchImpl,
            logger: { warn: vi.fn() }
        });

        expect(result.source).toBe('cache_legacy');
        expect(result.asset.cloudinary_url).toContain('xai.svg');
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(uploadBuffer).not.toHaveBeenCalled();
    });
});
