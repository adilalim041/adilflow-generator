import { describe, it, expect } from 'vitest';
import directives from '../lib/imagePromptDirectives.js';

const {
    findEntityVisualDirective,
    applyEntityImagePromptDirectives
} = directives;

describe('image prompt entity directives', () => {
    it('detects OpenAI stories from title aliases', () => {
        const directive = findEntityVisualDirective({
            raw_title: 'OpenAI launches new Academy courses for practical AI skills'
        });

        expect(directive.slug).toBe('openai');
    });

    it('adds Sam Altman editorial direction to OpenAI image prompts', () => {
        const prompt = applyEntityImagePromptDirectives(
            { raw_title: 'OpenAI launches new Academy courses for practical AI skills' },
            'A dramatic compass in mountains, realistic lighting, no text.'
        );

        expect(prompt).toContain('Sam Altman');
        expect(prompt).toContain('not a documentary photo of a real event');
        expect(prompt).toContain('real brand logo overlay');
        expect(prompt).toContain('slightly right-of-center');
        expect(prompt).toContain('A dramatic compass');
    });

    it('adds Dario Amodei editorial direction to Anthropic and Claude prompts', () => {
        const prompt = applyEntityImagePromptDirectives(
            { raw_title: 'Anthropic launches Claude Opus update with new coding tools' },
            'A realistic office scene about model evaluation.'
        );

        expect(prompt).toContain('Dario Amodei');
        expect(prompt).toContain('Anthropic or Claude story');
        expect(prompt).toContain('real brand logo overlay');
    });

    it('adds the right public figure for other major AI brands', () => {
        expect(applyEntityImagePromptDirectives(
            { raw_title: 'Meta releases a new Llama model' },
            'Editorial newsroom scene.'
        )).toContain('Mark Zuckerberg');
        expect(applyEntityImagePromptDirectives(
            { raw_title: 'xAI expands Grok features' },
            'Editorial newsroom scene.'
        )).toContain('Elon Musk');
        expect(applyEntityImagePromptDirectives(
            { raw_title: 'Nvidia announces new Blackwell systems' },
            'Editorial newsroom scene.'
        )).toContain('Jensen Huang');
    });

    it('does not add person direction to unrelated brands', () => {
        const original = 'A realistic office scene about a startup funding round.';
        const prompt = applyEntityImagePromptDirectives(
            { raw_title: 'Perplexity releases a new browser feature' },
            original
        );

        expect(prompt).toBe(original);
    });

    it('does not duplicate directives when the prompt already has the layout guard', () => {
        const original = 'Feature Sam Altman in an editorial scene with a real brand logo overlay area.';
        const prompt = applyEntityImagePromptDirectives(
            { raw_title: 'OpenAI launches new Academy courses' },
            original
        );

        expect(prompt).toBe(original);
    });
});
