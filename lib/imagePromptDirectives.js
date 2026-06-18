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
            'Feature Dario Amodei as the central recognizable public figure in a symbolic editorial scene connected to this Anthropic or Claude story. He should read as Dario Amodei: dark curly hair, glasses, slim build, thoughtful expression, casual dark sweater or simple executive clothing.'
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
    'Create one vivid front-page cover scene with tension, action, and a clear visual thesis.',
    'Prefer a real-world setting with people: office, classroom, conference table, product demo, research lab, public stage, newsroom, executive workspace, government hallway, court, or negotiation room.',
    'Do not make the image object-only, a plain executive portrait, a generic conference crowd, or a static person standing in soft light.',
    'Compose the person in the foreground, slightly right-of-center when possible.',
    'Use layered depth: foreground subject, midground action or symbolic prop, background setting.',
    'Leave a clean upper-left or behind-shoulder background plane for a separate real brand logo overlay that will be added later by the template.',
    'Do not generate the brand logo yourself and do not generate readable text.'
].join(' ');

const EDITORIAL_SCENE_DIRECTIVES = [
    {
        slug: 'government-pressure',
        aliases: [
            'government', 'u s government', 'us government', 'white house', 'trump',
            'administration', 'pentagon', 'department of war', 'defense department',
            'ban', 'banned', 'took down', 'policy', 'regulation', 'regulator',
            'senate', 'hearing', 'washington', 'order'
        ],
        directive:
            'Storyboard: high-stakes satirical political editorial composite. Put the public figure inside a tense government power scene: Oval Office, White House hallway, hearing room, marble corridor, or negotiation table. Use foreground action and scale contrast, such as an oversized official shoe, huge gavel, heavy stamp, stacks of documents, guards, or a looming desk, only as symbolic metaphor. If Donald Trump or a US agency is central in the article, include them only as an editorial metaphor and not as a claim that the exact scene happened. Make it dynamic, cinematic, and readable at thumbnail size.'
    },
    {
        slug: 'benchmark-model-launch',
        aliases: [
            'benchmark', 'benchmarks', 'model', 'models', 'mythos', 'fable',
            'opus', 'sonnet', 'class ai', 'new level', 'scores', 'performance',
            'release', 'released', 'launch', 'launched', 'preview', 'frontier'
        ],
        directive:
            'Storyboard: dramatic product/model reveal. Show the public figure unveiling a powerful new AI system in a real-world lab, auditorium, war-room, evaluation room, or glass control center. Add physical stakes: giant sealed model vault, glowing benchmark board with unreadable marks, competing teams watching, a heavy curtain being pulled, or researchers reacting. Avoid simple portrait staging.'
    },
    {
        slug: 'legal-dispute',
        aliases: [
            'lawsuit', 'sued', 'court', 'judge', 'legal', 'copyright',
            'settlement', 'allegedly', 'misleading', 'customers', 'dispute'
        ],
        directive:
            'Storyboard: legal pressure scene. Use courthouse steps, a courtroom corridor, attorneys, files, a judge bench, subpoenas, or a negotiation table as the visual metaphor. Keep the public figure under visible pressure, with dramatic foreground documents or a gavel-like symbol.'
    },
    {
        slug: 'market-money-pressure',
        aliases: [
            'funding', 'valuation', 'market', 'share', 'drops', 'revenue',
            'cost', 'price', 'month', 'usage', 'bill', 'grant', 'credits',
            'acquire', 'acquisition', 'deal'
        ],
        directive:
            'Storyboard: business pressure scene. Use boardroom tension, investor desk, cash stacks, contracts, valuation charts with no readable labels, negotiation table, or a financial newsroom. Put the public figure in an active decision moment, not a calm portrait.'
    },
    {
        slug: 'workflow-productivity',
        aliases: [
            'codex', 'coding', 'developer', 'developers', 'workflow', 'plugin',
            'plugins', 'computer use', 'desktop', 'macos', 'windows', 'agent',
            'agents', 'tools', 'browser'
        ],
        directive:
            'Storyboard: product workflow scene. Use a real workstation, multi-screen desk, app windows blurred and unreadable, team review room, or engineer operating an AI agent. Put the public figure or main user in the foreground with visible hands-on action.'
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

function scoreAliases(text, aliases, weight) {
    const normalizedText = normalizeText(text);
    if (!normalizedText) return 0;
    return aliases.reduce((score, alias) => {
        const normalizedAlias = normalizeText(alias);
        if (!normalizedAlias || !textMatchesAlias(normalizedText, normalizedAlias)) return score;
        return score + normalizedAlias.length * weight;
    }, 0);
}

function scoreRuleByArticleFields(article, aliases) {
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

    return fields.reduce((sum, field) => sum + scoreAliases(field.value, aliases, field.weight), 0);
}

function findEntityVisualDirective(article) {
    const candidates = ENTITY_VISUAL_DIRECTIVES
        .map(rule => ({
            rule,
            score: scoreRuleByArticleFields(article, rule.aliases)
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);

    return candidates[0]?.rule || null;
}

function findEditorialSceneDirective(article) {
    const candidates = EDITORIAL_SCENE_DIRECTIVES
        .map(rule => ({
            rule,
            score: scoreRuleByArticleFields(article, rule.aliases)
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);

    return candidates[0]?.rule || {
        slug: 'general-editorial-tension',
        directive:
            'Storyboard: build a concrete editorial metaphor with visible stakes, human action, and a real-world location. Use a bold foreground prop, a reaction from people, or a clear before/after tension point so the cover does not look like a generic portrait.'
    };
}

function applyEntityImagePromptDirectives(article, prompt) {
    const original = String(prompt || '').trim();
    if (!original) return original;

    const directive = findEntityVisualDirective(article);
    if (!directive) return original;
    const sceneDirective = findEditorialSceneDirective(article);

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
        sceneDirective.directive,
        original,
        'Keep the composition photorealistic and editorial, with realistic faces, real camera perspective, and strong foreground action. Leave clean lower-third negative space for the separate template headline. No generated text, no watermarks, no AI-generated logos.'
    ].join(' ');
}

module.exports = {
    ENTITY_VISUAL_DIRECTIVES,
    EDITORIAL_SCENE_DIRECTIVES,
    findEntityVisualDirective,
    findEditorialSceneDirective,
    applyEntityImagePromptDirectives
};
