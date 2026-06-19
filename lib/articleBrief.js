const STOP_PROPER_NOUNS = new Set([
    'A', 'An', 'And', 'Are', 'As', 'At', 'By', 'For', 'From', 'In', 'Into',
    'Is', 'It', 'Its', 'New', 'Of', 'On', 'Or', 'Over', 'The', 'This', 'To',
    'With', 'Without', 'After', 'Before', 'Inside', 'About', 'Against'
]);

function articleText(article) {
    return [
        article?.raw_title,
        article?.title,
        article?.headline,
        article?.raw_summary,
        article?.summary,
        String(article?.raw_text || '').slice(0, 2500)
    ].filter(Boolean).join(' ');
}

function addTerm(terms, value) {
    const normalized = String(value || '')
        .replace(/[^\w.+-]+$/g, '')
        .replace(/^[^\w]+/g, '')
        .trim();
    if (!normalized || normalized.length < 2) return;
    if (STOP_PROPER_NOUNS.has(normalized)) return;
    if (/^\d+$/.test(normalized)) return;
    terms.set(normalized.toLowerCase(), normalized);
}

function extractProtectedTerms(article, maxTerms = 18) {
    const text = articleText(article);
    const terms = new Map();

    const explicitPatterns = [
        /\b[A-Z][A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*(?:\s+[A-Z][A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*){0,3}\b/g,
        /\b[A-Z]{2,}[A-Za-z0-9-]*\b/g,
        /\b[a-z][A-Za-z]*[A-Z][A-Za-z0-9-]*\b/g,
        /\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b/g
    ];

    for (const pattern of explicitPatterns) {
        for (const match of text.matchAll(pattern)) {
            const value = match[0].trim();
            if (!value) continue;
            const parts = value.split(/\s+/).filter(part => !STOP_PROPER_NOUNS.has(part));
            if (parts.length > 0) addTerm(terms, parts.join(' '));
        }
    }

    return [...terms.values()].slice(0, maxTerms);
}

function buildArticleBriefForPrompt(article, { visualDirective = null, sceneDirective = null } = {}) {
    const protectedTerms = extractProtectedTerms(article);
    const lines = [
        'ARTICLE BRIEF - use this as factual grounding, not as article text:',
        protectedTerms.length
            ? `- Protected names/products/models: ${protectedTerms.join(', ')}. Keep these exact; do not translate or transliterate them.`
            : '- Protected names/products/models: none detected.',
        visualDirective?.slug
            ? `- Primary company/entity slug: ${visualDirective.slug}.`
            : '- Primary company/entity slug: unknown.',
        visualDirective?.person
            ? `- Public figure for visual reference: ${visualDirective.person}.`
            : '- Public figure for visual reference: unknown; do not invent a founder/CEO name.',
        sceneDirective?.slug
            ? `- Chosen visual conflict/story type: ${sceneDirective.slug}.`
            : '- Chosen visual conflict/story type: unknown.'
    ];

    if (sceneDirective?.slug === 'government-pressure') {
        lines.push('- Agency rule: US/government/Trump/export-control side is the pressure force; the AI company/person/model is constrained by that pressure.');
        lines.push('- Headline direction: frame it as a conflict/war/pressure between the government and the company/model, not as the company attacking its own model.');
    }

    lines.push('- Headline must preserve the real direction of the story: who did what to whom, and why it matters.');
    lines.push('- Image prompt must visualize that relationship as satire, not copy random nouns from the article.');

    return lines.join('\n');
}

module.exports = {
    articleText,
    extractProtectedTerms,
    buildArticleBriefForPrompt
};
