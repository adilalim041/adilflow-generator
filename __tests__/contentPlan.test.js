import { describe, it, expect } from 'vitest';
import { getBrainContentPlan, hasBrainContentPlan } from '../lib/contentPlan.js';

describe('Brain content plan adapter', () => {
    it('maps scores_detail.content_plan into Generator content fields', () => {
        const article = {
            scores_detail: {
                content_plan: {
                    version: 1,
                    source: 'llm',
                    template: { template_id: 'ctrl-light-news' },
                    copy: {
                        headline_ru: 'США ЗАЖАЛИ CLAUDE В ТИСКАХ',
                        headline2_ru: 'Mythos и Fable под давлением',
                        caption_ru: 'Anthropic столкнулась с ограничениями вокруг моделей.',
                        hashtags: '#Anthropic #Claude #AI',
                        cta_ru: 'Следи за ИИ'
                    },
                    visual: {
                        image_prompt: 'Dario Amodei squeezed by a giant government stamp, photorealistic satire, no text, no logos.',
                        angle: 'government-pressure',
                        image_strategy: 'generate_if_available',
                        needs_company_logo: true,
                        needs_person_reference: true
                    }
                }
            }
        };

        const content = getBrainContentPlan(article);

        expect(hasBrainContentPlan(article)).toBe(true);
        expect(content.headline_ru).toBe('США ЗАЖАЛИ CLAUDE В ТИСКАХ');
        expect(content.image_prompt).toContain('Dario Amodei');
        expect(content.angle).toBe('government-pressure');
        expect(content.template_id).toBe('ctrl-light-news');
        expect(content.content_plan_source).toBe('llm');
    });

    it('returns null when no executable plan exists', () => {
        expect(getBrainContentPlan({ scores_detail: {} })).toBeNull();
        expect(getBrainContentPlan({ scores_detail: { content_plan: { copy: {}, visual: {} } } })).toBeNull();
    });
});
