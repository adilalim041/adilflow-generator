import { describe, it, expect, vi } from 'vitest';
import discovery from '../lib/personReferenceDiscovery.js';

const {
    personSlugFromName,
    assertTrustedPersonReferenceUrl,
    pickExactPersonSearchResult,
    findWikidataPersonImageCandidate,
    resolvePersonReferenceAsset
} = discovery;

function jsonResponse(data) {
    return {
        ok: true,
        json: async () => data
    };
}

function imageResponse({ url = 'https://upload.wikimedia.org/example.jpg', mimeType = 'image/jpeg' } = {}) {
    const bytes = new Uint8Array(1200);
    bytes.fill(7);
    return {
        ok: true,
        url,
        headers: {
            get: (key) => {
                const normalized = String(key).toLowerCase();
                if (normalized === 'content-type') return mimeType;
                if (normalized === 'content-length') return String(bytes.byteLength);
                return null;
            }
        },
        arrayBuffer: async () => bytes.buffer
    };
}

describe('person reference discovery', () => {
    it('normalizes person slugs', () => {
        expect(personSlugFromName('Dario Amodei')).toBe('dario-amodei');
        expect(personSlugFromName(' Sam  Altman ')).toBe('sam-altman');
    });

    it('rejects untrusted reference hosts', () => {
        expect(() => assertTrustedPersonReferenceUrl('https://commons.wikimedia.org/wiki/Special:Redirect/file/Dario.jpg')).not.toThrow();
        expect(() => assertTrustedPersonReferenceUrl('https://upload.wikimedia.org/wikipedia/commons/a/a1/Dario.jpg')).not.toThrow();
        expect(() => assertTrustedPersonReferenceUrl('http://upload.wikimedia.org/file.jpg')).toThrow('https');
        expect(() => assertTrustedPersonReferenceUrl('https://example.com/file.jpg')).toThrow('not allowlisted');
    });

    it('picks exact Wikidata person search results', () => {
        const result = pickExactPersonSearchResult([
            { id: 'Q1', label: 'Dario Amodei' },
            { id: 'Q2', label: 'Someone Else', aliases: ['Dario'] }
        ], 'Dario Amodei');

        expect(result.id).toBe('Q1');
    });

    it('finds a Wikidata P18 image candidate', async () => {
        const fetchImpl = vi.fn(async (url) => {
            const href = String(url);
            if (href.includes('wbsearchentities')) {
                return jsonResponse({ search: [{ id: 'Q123', label: 'Dario Amodei' }] });
            }
            if (href.includes('Special:EntityData')) {
                return jsonResponse({
                    entities: {
                        Q123: {
                            claims: {
                                P18: [
                                    {
                                        mainsnak: {
                                            datavalue: { value: 'Dario_Amodei.jpg' }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                });
            }
            throw new Error(`Unexpected URL ${href}`);
        });

        const candidate = await findWikidataPersonImageCandidate('Dario Amodei', fetchImpl);

        expect(candidate.wikidata_id).toBe('Q123');
        expect(candidate.source_url).toContain('commons.wikimedia.org');
        expect(candidate.source_url).toContain('Dario_Amodei.jpg');
    });

    it('uses cached approved person references', async () => {
        const brainFetch = vi.fn(async (path) => {
            if (path.startsWith('/api/entity-assets')) {
                return {
                    assets: [
                        {
                            id: 9,
                            entity_slug: 'anthropic',
                            asset_type: 'person_reference',
                            person_entity_slug: 'dario-amodei',
                            cloudinary_url: 'https://res.cloudinary.com/demo/image/upload/dario.jpg',
                            status: 'approved',
                            metadata: { person_slug: 'dario-amodei', person_name: 'Dario Amodei' }
                        }
                    ]
                };
            }
            throw new Error(`Unexpected path ${path}`);
        });

        const result = await resolvePersonReferenceAsset({
            visualDirective: { entity_slug: 'anthropic', person: 'Dario Amodei' },
            brainFetch,
            uploadBuffer: vi.fn(),
            fetchImpl: vi.fn(),
            logger: { warn: vi.fn() }
        });

        expect(result.source).toBe('cache');
        expect(result.asset.id).toBe(9);
    });

    it('discovers, uploads, and saves a missing person reference', async () => {
        const brainFetch = vi.fn(async (path, options = {}) => {
            if (path.startsWith('/api/entity-assets') && options.method !== 'POST') {
                return { assets: [] };
            }
            if (path === '/api/entities' && options.method === 'POST') {
                const body = JSON.parse(options.body);
                expect(body.slug).toBe('dario-amodei');
                expect(body.parent_entity_slug).toBe('anthropic');
                return { entity: body };
            }
            if (path === '/api/entity-assets' && options.method === 'POST') {
                const body = JSON.parse(options.body);
                expect(body.asset_type).toBe('person_reference');
                expect(body.person_entity_slug).toBe('dario-amodei');
                return { asset: { id: 12, ...body } };
            }
            throw new Error(`Unexpected path ${path}`);
        });
        const fetchImpl = vi.fn(async (url) => {
            const href = String(url);
            if (href.includes('wbsearchentities')) {
                return jsonResponse({ search: [{ id: 'Q123', label: 'Dario Amodei' }] });
            }
            if (href.includes('Special:EntityData')) {
                return jsonResponse({
                    entities: {
                        Q123: {
                            claims: {
                                P18: [{ mainsnak: { datavalue: { value: 'Dario_Amodei.jpg' } } }]
                            }
                        }
                    }
                });
            }
            if (href.includes('Special:Redirect/file')) {
                return imageResponse();
            }
            throw new Error(`Unexpected URL ${href}`);
        });
        const uploadBuffer = vi.fn(async (buffer, options) => {
            expect(buffer.byteLength).toBeGreaterThan(1000);
            expect(options.folder).toBe('adilflow_person_references');
            return 'https://res.cloudinary.com/demo/image/upload/dario-reference.jpg';
        });

        const result = await resolvePersonReferenceAsset({
            visualDirective: { entity_slug: 'anthropic', person: 'Dario Amodei' },
            brainFetch,
            uploadBuffer,
            fetchImpl,
            logger: { warn: vi.fn() }
        });

        expect(result.source).toBe('discovered');
        expect(result.asset.id).toBe(12);
        expect(uploadBuffer).toHaveBeenCalled();
    });
});
