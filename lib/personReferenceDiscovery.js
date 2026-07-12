const WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_ENTITY_URL = 'https://www.wikidata.org/wiki/Special:EntityData';
const COMMONS_REDIRECT_URL = 'https://commons.wikimedia.org/wiki/Special:Redirect/file';
const USER_AGENT = 'AdilFlowGenerator/1.0 (person reference discovery; Wikimedia/Wikidata)';

const ALLOWED_PERSON_REFERENCE_HOSTS = new Set([
    'commons.wikimedia.org',
    'upload.wikimedia.org'
]);

function personSlugFromName(name) {
    return String(name || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function normalizePersonName(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function assertTrustedPersonReferenceUrl(rawUrl) {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') {
        throw new Error('Person reference URL must use https');
    }
    if (parsed.username || parsed.password) {
        throw new Error('Person reference URL must not contain credentials');
    }
    if (!ALLOWED_PERSON_REFERENCE_HOSTS.has(parsed.hostname)) {
        throw new Error(`Person reference host is not allowlisted: ${parsed.hostname}`);
    }
    return parsed;
}

async function fetchJson(url, fetchImpl = fetch) {
    const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
            Accept: 'application/json',
            'User-Agent': USER_AGENT
        }
    });
    if (!response.ok) {
        throw new Error(`Reference metadata returned ${response.status}`);
    }
    return response.json();
}

function pickExactPersonSearchResult(results, personName) {
    const expected = normalizePersonName(personName);
    return (results || []).find(item => {
        const label = normalizePersonName(item?.label);
        const aliases = Array.isArray(item?.aliases)
            ? item.aliases.map(normalizePersonName)
            : [];
        return label === expected || aliases.includes(expected);
    }) || null;
}

async function findWikidataPersonImageCandidate(personName, fetchImpl = fetch) {
    const searchUrl = new URL(WIKIDATA_API_URL);
    searchUrl.search = new URLSearchParams({
        action: 'wbsearchentities',
        search: personName,
        language: 'en',
        format: 'json',
        type: 'item',
        limit: '5'
    }).toString();

    const searchData = await fetchJson(searchUrl, fetchImpl);
    const searchResult = pickExactPersonSearchResult(searchData?.search || [], personName);
    if (!searchResult?.id) return null;

    const entityUrl = `${WIKIDATA_ENTITY_URL}/${encodeURIComponent(searchResult.id)}.json`;
    const entityData = await fetchJson(entityUrl, fetchImpl);
    const entity = entityData?.entities?.[searchResult.id];
    const imageFile = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (!imageFile) return null;

    const imageUrl = `${COMMONS_REDIRECT_URL}/${encodeURIComponent(imageFile)}`;
    return {
        person_name: personName,
        person_slug: personSlugFromName(personName),
        wikidata_id: searchResult.id,
        source_url: imageUrl,
        source_name: 'Wikimedia Commons via Wikidata P18',
        license_note: 'Wikimedia Commons person image; verify file license and personality rights for production use.',
        quality_score: 82,
        metadata: {
            discovery_method: 'wikidata_p18',
            wikidata_id: searchResult.id,
            commons_file: imageFile
        }
    };
}

async function downloadPersonReferenceCandidate(candidate, fetchImpl = fetch) {
    assertTrustedPersonReferenceUrl(candidate.source_url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetchImpl(candidate.source_url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.1',
                'User-Agent': USER_AGENT
            }
        });
        if (!response.ok) {
            throw new Error(`Person reference image returned ${response.status}`);
        }

        const finalUrl = response.url || candidate.source_url;
        assertTrustedPersonReferenceUrl(finalUrl);

        const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
            throw new Error(`Unsupported person reference content-type: ${mimeType || 'unknown'}`);
        }

        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > 8_000_000) {
            throw new Error('Person reference image is too large');
        }

        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > 8_000_000) {
            throw new Error('Person reference image is too large');
        }
        if (arrayBuffer.byteLength < 1000) {
            throw new Error('Person reference image is unexpectedly small');
        }

        return {
            buffer: Buffer.from(arrayBuffer),
            mimeType,
            finalUrl,
            extension: mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1]
        };
    } finally {
        clearTimeout(timeout);
    }
}

function pickCachedPersonReferenceAsset(assets, personName) {
    const targetSlug = personSlugFromName(personName);
    const targetName = normalizePersonName(personName);
    return (assets || []).find(asset => {
        const assetPersonSlug = personSlugFromName(asset?.person_entity_slug || asset?.metadata?.person_slug);
        const assetPersonName = normalizePersonName(asset?.metadata?.person_name || asset?.display_name);
        return assetPersonSlug === targetSlug || assetPersonName.includes(targetName);
    }) || null;
}

async function resolvePersonReferenceAsset({
    visualDirective,
    brainFetch,
    uploadBuffer,
    fetchImpl = fetch,
    logger = console,
    discoveryEnabled = true
}) {
    if (!visualDirective?.entity_slug || !visualDirective?.person) {
        return { asset: null, source: 'no_visual_directive' };
    }

    const personName = visualDirective.person;
    const personSlug = personSlugFromName(personName);

    try {
        const entitySlug = encodeURIComponent(visualDirective.entity_slug);
        const cached = await brainFetch(`/api/entity-assets?entity_slug=${entitySlug}&asset_type=person_reference&status=approved`, {
            method: 'GET'
        });
        const cachedAsset = pickCachedPersonReferenceAsset(cached?.assets || [], personName);
        if (cachedAsset?.cloudinary_url) {
            return { asset: cachedAsset, source: 'cache' };
        }

        if (!discoveryEnabled) {
            return { asset: null, source: 'disabled' };
        }

        const candidate = await findWikidataPersonImageCandidate(personName, fetchImpl);
        if (!candidate) {
            return { asset: null, source: 'no_candidate' };
        }

        const downloaded = await downloadPersonReferenceCandidate(candidate, fetchImpl);
        const cloudinaryUrl = await uploadBuffer(downloaded.buffer, {
            mimeType: downloaded.mimeType,
            folder: 'adilflow_person_references',
            filename: `${personSlug}-reference.${downloaded.extension || 'jpg'}`
        });

        await brainFetch('/api/entities', {
            method: 'POST',
            body: JSON.stringify({
                slug: personSlug,
                name: personName,
                entity_type: 'person',
                aliases: [personName],
                parent_entity_slug: visualDirective.entity_slug,
                notes: 'Auto-discovered public figure reference for editorial image generation.',
                is_active: true
            })
        });

        const saved = await brainFetch('/api/entity-assets', {
            method: 'POST',
            body: JSON.stringify({
                entity_slug: visualDirective.entity_slug,
                asset_type: 'person_reference',
                variant: 'primary',
                display_name: `${personName} reference`,
                person_entity_slug: personSlug,
                source_url: downloaded.finalUrl || candidate.source_url,
                source_name: candidate.source_name,
                license_note: candidate.license_note,
                cloudinary_url: cloudinaryUrl,
                quality_score: candidate.quality_score,
                status: 'approved',
                metadata: {
                    ...candidate.metadata,
                    person_slug: personSlug,
                    person_name: personName,
                    usage: 'identity_reference_only',
                    mime_type: downloaded.mimeType
                }
            })
        });

        return { asset: saved?.asset || null, source: 'discovered' };
    } catch (error) {
        logger.warn?.({
            entity_slug: visualDirective.entity_slug,
            person: personName,
            error: error.message
        }, 'Person reference discovery failed');
        return { asset: null, source: 'error', error: error.message };
    }
}

module.exports = {
    ALLOWED_PERSON_REFERENCE_HOSTS,
    personSlugFromName,
    normalizePersonName,
    assertTrustedPersonReferenceUrl,
    pickExactPersonSearchResult,
    findWikidataPersonImageCandidate,
    downloadPersonReferenceCandidate,
    pickCachedPersonReferenceAsset,
    resolvePersonReferenceAsset
};
