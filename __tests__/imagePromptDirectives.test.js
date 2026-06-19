import { describe, it, expect } from 'vitest';
import directives from '../lib/imagePromptDirectives.js';

const {
    findEntityVisualDirective,
    findEditorialSceneDirective,
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
        expect(prompt).toContain('Storyboard: absurd productivity satire');
    });

    it('uses absurd secretary roleplay for AI assistant stories', () => {
        const article = {
            raw_title: 'Anthropic launches an AI secretary for email and scheduling',
            raw_summary: 'Claude can now help with calendar tasks and administrative work.'
        };

        const scene = findEditorialSceneDirective(article);
        const prompt = applyEntityImagePromptDirectives(
            article,
            'A photorealistic editorial scene about office work.'
        );

        expect(scene.slug).toBe('ai-secretary-roleplay');
        expect(prompt).toContain('Dario Amodei');
        expect(prompt).toContain('overwhelmed executive secretary');
        expect(prompt).toContain('human office secretaries or assistants react emotionally');
    });

    it('uses an AI race duel when one company overtakes another', () => {
        const article = {
            raw_title: 'Anthropic beats OpenAI in a benchmark race',
            raw_summary: 'The new Claude model outperforms GPT in several tests.'
        };

        const scene = findEditorialSceneDirective(article);
        const prompt = applyEntityImagePromptDirectives(
            article,
            'A photorealistic editorial scene about model competition.'
        );

        expect(scene.slug).toBe('ai-race-duel');
        expect(prompt).toContain('Dario Amodei');
        expect(prompt).toContain('track runner');
        expect(prompt).toContain('Sam Altman');
        expect(prompt).toContain('The winner should visibly overtake the rival');
    });

    it('uses coupon angel satire for free credit stories', () => {
        const article = {
            raw_title: 'OpenAI gives developers free API credits',
            raw_summary: 'The company is offering free tokens and grants to builders.'
        };

        const scene = findEditorialSceneDirective(article);
        const prompt = applyEntityImagePromptDirectives(
            article,
            'A photorealistic editorial scene about developer credits.'
        );

        expect(scene.slug).toBe('free-credit-giveaway');
        expect(prompt).toContain('Sam Altman');
        expect(prompt).toContain('coupon angel');
        expect(prompt).toContain('developers reaching from a crowd');
    });

    it('prioritizes the title brand over body mentions of competing brands', () => {
        const directive = findEntityVisualDirective({
            raw_title: 'Anthropic hands the public Mythos-class AI',
            raw_summary: 'The article compares the release with OpenAI and GPT products.',
            raw_text: 'OpenAI, ChatGPT, GPT, and Codex are mentioned as market context, but the story is about Anthropic.'
        });

        expect(directive.slug).toBe('anthropic');

        const prompt = applyEntityImagePromptDirectives(
            {
                raw_title: 'Anthropic hands the public Mythos-class AI',
                raw_summary: 'The article compares the release with OpenAI and GPT products.',
                raw_text: 'OpenAI, ChatGPT, GPT, and Codex are mentioned as market context, but the story is about Anthropic.'
            },
            'A photorealistic editorial scene about the launch.'
        );

        expect(prompt).toContain('Dario Amodei');
        expect(prompt).not.toContain('Sam Altman');
    });

    it('adds model reveal storyboard for benchmark and model launch stories', () => {
        const article = {
            raw_title: 'Anthropic released Mythos-class AI with new benchmark records',
            raw_summary: 'The release includes higher scores and frontier model performance.'
        };

        const scene = findEditorialSceneDirective(article);
        const prompt = applyEntityImagePromptDirectives(
            article,
            'A photorealistic editorial scene about the launch.'
        );

        expect(scene.slug).toBe('benchmark-model-launch');
        expect(prompt).toContain('Storyboard: absurd model-launch spectacle');
        expect(prompt).toContain('Dario Amodei');
    });

    it('adds political pressure storyboard for Anthropic government stories', () => {
        const article = {
            raw_title: 'Anthropic to meet with Trump administration over Mythos/Fable dispute',
            raw_summary: 'The company is discussing AI policy with the US government.'
        };

        const scene = findEditorialSceneDirective(article);
        const prompt = applyEntityImagePromptDirectives(
            article,
            'A photorealistic editorial scene about a policy dispute.'
        );

        expect(scene.slug).toBe('government-pressure');
        expect(prompt).toContain('Dario Amodei');
        expect(prompt).toContain('high-stakes satirical political editorial composite');
        expect(prompt).toContain('oversized official shoe');
        expect(prompt).not.toContain('Sam Altman');
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
