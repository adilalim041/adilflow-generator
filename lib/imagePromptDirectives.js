const ENTITY_VISUAL_DIRECTIVES = [
    {
        slug: 'openai',
        aliases: ['openai', 'chatgpt', 'codex', 'gpt', 'sora'],
        person: 'Sam Altman',
        directive:
            'Feature Sam Altman as the central recognizable public figure in a symbolic editorial scene connected to this OpenAI story.'
    },
    {
        slug: 'anthropic',
        aliases: ['anthropic', 'claude', 'claude code', 'claude opus', 'claude sonnet'],
        person: 'Dario Amodei',
        directive:
            'Feature Dario Amodei as the central recognizable public figure in a symbolic editorial scene connected to this Anthropic or Claude story.'
    },
    {
        slug: 'google',
        aliases: ['google', 'gemini', 'deepmind', 'google deepmind', 'alphabet'],
        person: 'Sundar Pichai',
        directive:
            'Feature Sundar Pichai as the central recognizable public figure in a symbolic editorial scene connected to this Google, Gemini, DeepMind, or Alphabet story.'
    },
    {
        slug: 'meta',
        aliases: ['meta', 'facebook', 'instagram', 'llama'],
        person: 'Mark Zuckerberg',
        directive:
            'Feature Mark Zuckerberg as the central recognizable public figure in a symbolic editorial scene connected to this Meta, Facebook, Instagram, or Llama story.'
    },
    {
        slug: 'xai',
        aliases: ['xai', 'x.ai', 'grok', 'xai grok'],
        person: 'Elon Musk',
        directive:
            'Feature Elon Musk as the central recognizable public figure in a symbolic editorial scene connected to this xAI or Grok story.'
    },
    {
        slug: 'apple',
        aliases: ['apple', 'iphone', 'ios', 'macos', 'siri'],
        person: 'Tim Cook',
        directive:
            'Feature Tim Cook as the central recognizable public figure in a symbolic editorial scene connected to this Apple story.'
    },
    {
        slug: 'nvidia',
        aliases: ['nvidia', 'geforce', 'cuda', 'blackwell', 'jensen huang'],
        person: 'Jensen Huang',
        directive:
            'Feature Jensen Huang as the central recognizable public figure in a symbolic editorial scene connected to this Nvidia story.'
    }
];

const EDITORIAL_SAFETY_AND_LAYOUT = [
    'Make it feel like a realistic magazine/photojournalistic metaphor, not a documentary photo of a real event.',
    'Prefer a real-world setting with people: office, classroom, conference table, product demo, research lab, public stage, newsroom, or executive workspace.',
    'Do not make the image object-only.',
    'Compose the person in the foreground, slightly right-of-center when possible.',
    'Leave a clean upper-left or behind-shoulder background plane for a separate real brand logo overlay that will be added later by the template.',
    'Do not generate the brand logo yourself and do not generate readable text.'
].join(' ');

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

function scoreAliases(text, aliases, weight) {
    const normalizedText = normalizeText(text);
    if (!normalizedText) return 0;
    return aliases.reduce((score, alias) => {
        const normalizedAlias = normalizeText(alias);
        if (!normalizedAlias || !textMatchesAlias(normalizedText, normalizedAlias)) return score;
        return score + normalizedAlias.length * weight;
    }, 0);
}

function findEntityVisualDirective(article) {
    const fields = [
        { value: article?.raw_title, weight: 12 },
        { value: article?.title, weight: 12 },
        { value: article?.headline, weight: 8 },
        { value: article?.raw_summary, weight: 4 },
        { value: article?.summary, weight: 4 },
        { value: article?.url, weight: 3 },
        { value: article?.raw_text, weight: 1 },
        { value: article?.body, weight: 1 }
    ];

    const candidates = ENTITY_VISUAL_DIRECTIVES
        .map(rule => ({
            rule,
            score: fields.reduce((sum, field) => sum + scoreAliases(field.value, rule.aliases, field.weight), 0)
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);

    return candidates[0]?.rule || null;
}

function applyEntityImagePromptDirectives(article, prompt) {
    const original = String(prompt || '').trim();
    if (!original) return original;

    const directive = findEntityVisualDirective(article);
    if (!directive) return original;

    const normalizedPrompt = normalizeText(original);
    if (
        textMatchesAlias(normalizedPrompt, directive.person)
        && normalizedPrompt.includes('real brand logo overlay')
    ) {
        return original;
    }

    return [
        directive.directive,
        EDITORIAL_SAFETY_AND_LAYOUT,
        original,
        'Keep the composition photorealistic and editorial. Leave clean lower-third negative space for the separate template headline. No generated text, no watermarks, no AI-generated logos.'
    ].join(' ');
}

module.exports = {
    ENTITY_VISUAL_DIRECTIVES,
    findEntityVisualDirective,
    applyEntityImagePromptDirectives
};
