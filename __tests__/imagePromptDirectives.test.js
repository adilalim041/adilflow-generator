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
        expect(prompt).toContain('A dramatic compass');
    });

    it('does not add OpenAI direction to unrelated brands', () => {
        const original = 'A realistic office scene about a new phone launch.';
        const prompt = applyEntityImagePromptDirectives(
            { raw_title: 'Apple releases a new iPhone camera feature' },
            original
        );

        expect(prompt).toBe(original);
    });
});
