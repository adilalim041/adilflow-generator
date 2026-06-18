const ENTITY_VISUAL_DIRECTIVES = [
    {
        slug: 'openai',
        aliases: ['openai', 'chatgpt', 'codex', 'gpt'],
        person: 'Sam Altman',
        directive:
            'Feature Sam Altman as the central recognizable public figure in a symbolic editorial scene connected to this OpenAI story. Make it feel like a realistic magazine/photojournalistic metaphor, not a documentary photo of a real event. Prefer a real-world setting with people: office, classroom, conference table, product demo, research lab, or public-stage moment. Do not make the image object-only.'
    }
];

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function textMatchesAlias(text, alias) {
    const normalizedAlias = normalizeText(alias);
    if (!normalizedAlias) return false;
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i').test(text);
}

function findEntityVisualDirective(article) {
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
    return ENTITY_VISUAL_DIRECTIVES.find(rule => rule.aliases.some(alias => textMatchesAlias(haystack, alias))) || null;
}

function applyEntityImagePromptDirectives(article, prompt) {
    const original = String(prompt || '').trim();
    if (!original) return original;

    const directive = findEntityVisualDirective(article);
    if (!directive) return original;

    const normalizedPrompt = normalizeText(original);
    if (textMatchesAlias(normalizedPrompt, directive.person)) {
        return original;
    }

    return [
        directive.directive,
        original,
        'Keep the composition photorealistic and editorial. Leave clean lower-third negative space for the separate template headline. No generated text, no watermarks, no AI-generated logos.'
    ].join(' ');
}

module.exports = {
    ENTITY_VISUAL_DIRECTIVES,
    findEntityVisualDirective,
    applyEntityImagePromptDirectives
};
