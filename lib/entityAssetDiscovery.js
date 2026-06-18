const TRUSTED_LOGO_CANDIDATES = {
    openai: [
        {
            url: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/OpenAI_logo_2025_(symbol).svg',
            source_name: 'Wikimedia Commons',
            license_note: 'Wikimedia Commons logo file; trademark restrictions may apply.',
            status: 'approved',
            quality_score: 90
        }
    ],
    anthropic: [simpleIconCandidate('anthropic')],
    google: [simpleIconCandidate('google')],
    apple: [simpleIconCandidate('apple')],
    meta: [simpleIconCandidate('meta')]
};

const ALLOWED_LOGO_HOSTS = new Set([
    'cdn.simpleicons.org',
    'commons.wikimedia.org',
    'upload.wikimedia.org'
]);

function simpleIconCandidate(slug) {
    return {
        url: `https://cdn.simpleicons.org/${slug}/000000`,
        source_name: 'Simple Icons',
        license_note: 'Simple Icons SVG; brand/trademark restrictions may apply.',
        status: 'approved',
        quality_score: 80
    };
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9а-яё]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function aliasMatches(text, alias) {
    const normalizedAlias = normalizeText(alias);
    if (!normalizedAlias || normalizedAlias.length < 2) return false;
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i').test(text);
}

function selectMentionedEntity(article, entities) {
    const haystack = normalizeText([
        article?.raw_title,
        article?.title,
        article?.headline,
        article?.raw_summary,
        article?.summary,
        article?.raw_text,
        article?.body,
        article?.url
    ].filter(Boolean).join(' '));

    if (!haystack) return null;

    const candidates = (entities || [])
        .filter(entity => entity && entity.slug && entity.entity_type === 'company')
        .map(entity => {
            const aliases = [entity.name, entity.slug, ...(entity.aliases || [])].filter(Boolean);
            const score = aliases.reduce((sum, alias) => sum + (aliasMatches(haystack, alias) ? String(alias).length : 0), 0);
            return { entity, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);

    return candidates[0]?.entity || null;
}

function getTrustedLogoCandidates(entitySlug) {
    return TRUSTED_LOGO_CANDIDATES[entitySlug] || [];
}

function assertTrustedLogoUrl(rawUrl) {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') {
        throw new Error('Logo candidate must use https');
    }
    if (parsed.username || parsed.password) {
        throw new Error('Logo candidate URL must not contain credentials');
    }
    if (!ALLOWED_LOGO_HOSTS.has(parsed.hostname)) {
        throw new Error(`Logo candidate host is not allowlisted: ${parsed.hostname}`);
    }
    return parsed;
}

async function downloadLogoCandidate(candidate, fetchImpl = fetch) {
    assertTrustedLogoUrl(candidate.url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetchImpl(candidate.url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: { Accept: 'image/svg+xml,image/png,image/webp,image/*;q=0.8,*/*;q=0.1' }
        });
        if (!response.ok) {
            throw new Error(`Logo candidate returned ${response.status}`);
        }

        const finalUrl = response.url || candidate.url;
        assertTrustedLogoUrl(finalUrl);

        const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg'].includes(contentType)) {
            throw new Error(`Unsupported logo content-type: ${contentType || 'unknown'}`);
        }

        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > 1_000_000) {
            throw new Error('Logo candidate is too large');
        }

        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > 1_000_000) {
            throw new Error('Logo candidate is too large');
        }
        if (arrayBuffer.byteLength < 100) {
            throw new Error('Logo candidate is unexpectedly small');
        }

        return {
            buffer: Buffer.from(arrayBuffer),
            mimeType: contentType,
            finalUrl
        };
    } finally {
        clearTimeout(timeout);
    }
}

function assetFromCacheResponse(data) {
    const assets = Array.isArray(data?.assets) ? data.assets : [];
    return assets.find(asset => asset?.cloudinary_url && asset.status === 'approved') || null;
}

async function resolveEntityLogoAsset({
    article,
    brainFetch,
    uploadBuffer,
    fetchImpl = fetch,
    logger = console
}) {
    try {
        const entitiesResponse = await brainFetch('/api/entities?entity_type=company&active_only=true', { method: 'GET' });
        const entity = selectMentionedEntity(article, entitiesResponse?.entities || []);
        if (!entity) {
            return { entity: null, asset: null, source: 'no_entity' };
        }

        const encodedSlug = encodeURIComponent(entity.slug);
        const cached = await brainFetch(`/api/entity-assets?entity_slug=${encodedSlug}&asset_type=logo_icon&status=approved`, { method: 'GET' });
        const cachedAsset = assetFromCacheResponse(cached);
        if (cachedAsset) {
            return { entity, asset: cachedAsset, source: 'cache' };
        }

        const candidate = getTrustedLogoCandidates(entity.slug)[0];
        if (!candidate) {
            return { entity, asset: null, source: 'no_candidate' };
        }

        const downloaded = await downloadLogoCandidate(candidate, fetchImpl);
        const cloudinaryUrl = await uploadBuffer(downloaded.buffer, {
            mimeType: downloaded.mimeType,
            folder: 'adilflow_entity_assets',
            filename: `${entity.slug}-logo-icon`
        });

        const saved = await brainFetch('/api/entity-assets', {
            method: 'POST',
            body: JSON.stringify({
                entity_slug: entity.slug,
                asset_type: 'logo_icon',
                variant: 'primary',
                display_name: `${entity.name} icon logo`,
                source_url: downloaded.finalUrl,
                source_name: candidate.source_name,
                license_note: candidate.license_note,
                cloudinary_url: cloudinaryUrl,
                quality_score: candidate.quality_score,
                status: candidate.status,
                metadata: {
                    discovery_method: 'trusted_logo_candidate',
                    original_candidate_url: candidate.url,
                    mime_type: downloaded.mimeType
                }
            })
        });

        return { entity, asset: saved?.asset || null, source: 'discovered' };
    } catch (error) {
        logger.warn?.({ articleId: article?.id, error: error.message }, 'Entity logo asset discovery failed');
        return { entity: null, asset: null, source: 'error', error: error.message };
    }
}

module.exports = {
    TRUSTED_LOGO_CANDIDATES,
    normalizeText,
    selectMentionedEntity,
    getTrustedLogoCandidates,
    assertTrustedLogoUrl,
    downloadLogoCandidate,
    resolveEntityLogoAsset
};
