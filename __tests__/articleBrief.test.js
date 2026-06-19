import { describe, it, expect } from 'vitest';
import brief from '../lib/articleBrief.js';

const { extractProtectedTerms, buildArticleBriefForPrompt } = brief;

describe('article brief prompt grounding', () => {
    it('extracts protected product/company/person terms without translating them', () => {
        const terms = extractProtectedTerms({
            raw_title: 'Anthropic says Mythos-class AI and Fable models are kept online by US export restrictions',
            raw_summary: 'Dario Amodei discussed Claude and the G7 in France.'
        });

        expect(terms).toContain('Anthropic');
        expect(terms).toContain('Mythos-class');
        expect(terms).toContain('Fable');
        expect(terms).toContain('US');
        expect(terms).toContain('Dario Amodei');
        expect(terms).toContain('Claude');
    });

    it('adds agency grounding for government pressure stories', () => {
        const result = buildArticleBriefForPrompt(
            {
                raw_title: 'Anthropic says Mythos-class AI and Fable models are kept online by US export restrictions',
                raw_summary: 'The conflict with the government escalated.'
            },
            {
                visualDirective: { slug: 'anthropic', person: 'Dario Amodei' },
                sceneDirective: { slug: 'government-pressure' }
            }
        );

        expect(result).toContain('Protected names/products/models');
        expect(result).toContain('Mythos-class');
        expect(result).toContain('Fable');
        expect(result).toContain('Dario Amodei');
        expect(result).toContain('US/government/Trump/export-control side is the pressure force');
        expect(result).toContain('not as the company attacking its own model');
    });

    it('does not invent a public figure when none is known', () => {
        const result = buildArticleBriefForPrompt(
            { raw_title: 'A new startup launches an AI search tool' },
            { visualDirective: null, sceneDirective: null }
        );

        expect(result).toContain('do not invent a founder/CEO name');
    });
});
