import { describe, it, expect } from 'vitest';

function extractJson(text) {
    const clean = String(text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    if (!clean) return {};
    try {
        return JSON.parse(clean);
    } catch {
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) {
            throw new Error('Model did not return valid JSON');
        }
        return JSON.parse(clean.slice(start, end + 1));
    }
}

function truncateWords(value, wordLimit) {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean);
    if (words.length <= wordLimit) return words.join(' ');
    return words.slice(0, wordLimit).join(' ');
}

function isBlank(value) {
    return value == null || (typeof value === 'string' && value.trim() === '');
}

describe('extractJson', () => {
    it('parses plain JSON', () => {
        expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    });

    it('extracts JSON from markdown code block', () => {
        expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });

    it('extracts JSON from surrounding text', () => {
        expect(extractJson('Here is the result: {"a":1} done')).toEqual({ a: 1 });
    });

    it('returns empty object for empty input', () => {
        expect(extractJson('')).toEqual({});
        expect(extractJson(null)).toEqual({});
    });

    it('throws for completely invalid input', () => {
        expect(() => extractJson('no json here')).toThrow('Model did not return valid JSON');
    });
});

describe('truncateWords', () => {
    it('returns text if within limit', () => {
        expect(truncateWords('hello world', 5)).toBe('hello world');
    });

    it('truncates to word limit', () => {
        expect(truncateWords('one two three four five', 3)).toBe('one two three');
    });

    it('handles empty input', () => {
        expect(truncateWords('', 5)).toBe('');
        expect(truncateWords(null, 5)).toBe('');
    });
});

describe('isBlank', () => {
    it('detects blank values', () => {
        expect(isBlank(null)).toBe(true);
        expect(isBlank(undefined)).toBe(true);
        expect(isBlank('')).toBe(true);
        expect(isBlank('   ')).toBe(true);
    });

    it('detects non-blank values', () => {
        expect(isBlank('hello')).toBe(false);
        expect(isBlank(0)).toBe(false);
    });
});
