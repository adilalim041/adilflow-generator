import { describe, it, expect } from 'vitest';
import artifacts from '../lib/headlineArtifacts.js';

const { fixHeadlineArtifacts, replaceKnownModelNameArtifacts, isGovernmentPressureArticle } = artifacts;

describe('headline artifact fixes', () => {
    const governmentAnthropicArticle = {
        raw_title: 'Anthropic says US government restrictions are keeping Mythos and Fable models online',
        raw_summary: 'Anthropic and the US government are in conflict over export restrictions and whether Mythos and Fable can be taken offline.'
    };

    it('keeps model names as product names instead of translating them', () => {
        const fixed = replaceKnownModelNameArtifacts(
            governmentAnthropicArticle,
            'АНТРОПИК ДУШИТ МИФЫ — ГОВЕРНМЕНТ УДЕРЖИВАЕТ МОДЕЛИ ОНЛАЙН'
        );

        expect(fixed).toContain('MYTHOS');
        expect(fixed).toContain('ПРАВИТЕЛЬСТВО США');
        expect(fixed).not.toContain('МИФЫ');
        expect(fixed).not.toContain('ГОВЕРНМЕНТ');
    });

    it('flips the agency when government pressure is the real story', () => {
        const fixed = fixHeadlineArtifacts(
            governmentAnthropicArticle,
            'АНТРОПИК ДУШИТ МИФЫ — ГОВЕРНМЕНТ УДЕРЖИВАЕТ МОДЕЛИ ОНЛАЙН'
        );

        expect(fixed).toBe('США **ДАВЯТ НА ANTHROPIC** И ДЕРЖАТ MYTHOS И FABLE ОНЛАЙН');
    });

    it('detects government pressure from export-restriction language', () => {
        expect(isGovernmentPressureArticle(governmentAnthropicArticle)).toBe(true);
    });
});
