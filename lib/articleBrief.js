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

function formatBrainArticleBriefForPrompt(brief) {
    if (!brief || typeof brief !== 'object') return null;

    const entities = brief.entities || {};
    const story = brief.story_logic || {};
    const creative = brief.creative_brief || {};
    const copy = brief.copy_brief || {};
    const segmentation = brief.segmentation || {};
    const assets = brief.assets_required || {};
    const protectedTerms = Array.isArray(entities.protected_terms) ? entities.protected_terms : [];
    const people = Array.isArray(entities.main_people) ? entities.main_people : [];
    const products = Array.isArray(entities.products) ? entities.products : [];
    const avoid = Array.isArray(creative.avoid) ? creative.avoid : [];

    return [
        'ARTICLE BRIEF FROM BRAIN - this is the source of truth for copy and visual generation:',
        `- Suitability score: ${brief.suitability?.score ?? 'unknown'}.`,
        `- Story angle: ${segmentation.angle || 'unknown'}; mood: ${segmentation.mood || 'unknown'}.`,
        `- Main company: ${entities.main_company || 'unknown'}.`,
        `- Main people/public figures: ${people.length ? people.join(', ') : 'unknown; do not invent a founder/CEO name'}.`,
        `- Products/models/protected names: ${protectedTerms.length ? protectedTerms.join(', ') : 'none detected'}. Keep these exact; do not translate or transliterate them.`,
        products.length ? `- Product/model focus: ${products.join(', ')}.` : null,
        entities.opposing_actor ? `- Opposing/pressure actor: ${entities.opposing_actor}.` : null,
        `- Agency: ${story.who || 'unknown'} did/announced: ${story.did_what || 'unknown'}; affected side: ${story.to_whom || 'unknown'}.`,
        story.why_it_matters ? `- Why it matters: ${story.why_it_matters}` : null,
        story.implications ? `- Implications: ${story.implications}` : null,
        story.risk_of_misread ? `- Risk of misread: ${story.risk_of_misread}` : null,
        `- Visual metaphor: ${creative.visual_metaphor || segmentation.angle || 'editorial-satire'}.`,
        creative.satirical_scene ? `- Satirical scene to visualize: ${creative.satirical_scene}` : null,
        creative.tone ? `- Visual tone: ${creative.tone}` : null,
        avoid.length ? `- Avoid: ${avoid.join('; ')}.` : null,
        `- Assets: generated_background=${Boolean(assets.needs_generated_background)}, company_logo=${Boolean(assets.needs_company_logo)}, person_reference=${Boolean(assets.needs_person_reference)}, template=${assets.preferred_template_kind || 'auto'}.`,
        copy.headline_direction ? `- Headline direction: ${copy.headline_direction}` : null,
        copy.caption_direction ? `- Caption direction: ${copy.caption_direction}` : null,
        '- Headline must preserve the real direction of the story: who did what to whom, and why it matters.',
        '- Image prompt must visualize the brief as premium realistic satire, not copy random nouns from the article.'
    ].filter(Boolean).join('\n');
}

module.exports = {
    articleText,
    extractProtectedTerms,
    buildArticleBriefForPrompt,
    formatBrainArticleBriefForPrompt
};
