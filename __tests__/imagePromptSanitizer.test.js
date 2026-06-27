import { describe, expect, it } from 'vitest';
import sanitizer from '../lib/imagePromptSanitizer.js';

const { sanitizeBrainImagePrompt } = sanitizer;

describe('sanitizeBrainImagePrompt', () => {
    it('keeps Brain scene details while removing generic AI visuals', () => {
        const prompt = [
            'Sam Altman as a stern banker holding a large golden key in front of a sealed AI bank vault.',
            'Use glowing AI data streams around the lock and an AI model figurine on the counter.',
            'Avoid cyberpunk palette and neon blue lighting.'
        ].join(' ');

        const result = sanitizeBrainImagePrompt(prompt);

        expect(result).toContain('stern banker');
        expect(result).toContain('large golden key');
        expect(result).toContain('sealed AI bank vault');
        expect(result).toContain('subtle abstract brand-color lighting');
        expect(result).toContain('abstract sealed model container');
        expect(result).not.toMatch(/AI data streams/i);
        expect(result).not.toMatch(/model figurine/i);
        expect(result).not.toMatch(/cyberpunk palette/i);
        expect(result).not.toMatch(/neon blue/i);
    });
});
