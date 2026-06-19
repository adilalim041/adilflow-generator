import { describe, it, expect } from 'vitest';
import brief from '../lib/articleBrief.js';

const { extractProtectedTerms, buildArticleBriefForPrompt, formatBrainArticleBriefForPrompt } = brief;

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

    it('uses Brain article brief as source-of-truth grounding', () => {
        const result = formatBrainArticleBriefForPrompt({
            suitability: { score: 8 },
            segmentation: { angle: 'government-pressure', mood: 'conflict' },
            entities: {
                main_company: 'Anthropic',
                main_people: ['Dario Amodei'],
                products: ['Mythos', 'Fable'],
                protected_terms: ['Anthropic', 'Claude', 'Mythos', 'Fable'],
                opposing_actor: 'US government / regulators'
            },
            story_logic: {
                who: 'US government / regulators',
                did_what: 'restricted access to Anthropic models',
                to_whom: 'Anthropic and Claude Mythos/Fable',
                why_it_matters: 'It changes model availability and competition.',
                risk_of_misread: 'Do not write that Anthropic attacks Mythos or Fable.'
            },
            creative_brief: {
                visual_metaphor: 'government-pressure',
                satirical_scene: 'Dario Amodei trapped between a government stamp and a model vault.',
                avoid: ['boring static portrait']
            },
            assets_required: {
                needs_generated_background: true,
                needs_company_logo: true,
                needs_person_reference: true,
                preferred_template_kind: 'logo-and-generated-background'
            },
            copy_brief: {
                headline_direction: 'Frame it as US pressure on Anthropic.'
            }
        });

        expect(result).toContain('ARTICLE BRIEF FROM BRAIN');
        expect(result).toContain('US government / regulators');
        expect(result).toContain('Dario Amodei');
        expect(result).toContain('Keep these exact');
        expect(result).toContain('Do not write that Anthropic attacks Mythos or Fable');
        expect(result).toContain('premium realistic satire');
    });
});
