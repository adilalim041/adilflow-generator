import { describe, it, expect } from 'vitest';
import context from '../lib/articleEntityContext.js';

const { buildEntityVisualDirectiveFromBrain } = context;

describe('article entity context', () => {
    it('builds a visual directive from Brain company/person entities', () => {
        const directive = buildEntityVisualDirectiveFromBrain(
            { raw_title: 'Perplexity launches a new AI browser' },
            [
                { slug: 'perplexity', name: 'Perplexity', entity_type: 'company', aliases: ['Perplexity AI'] },
                { slug: 'aravind-srinivas', name: 'Aravind Srinivas', entity_type: 'person', parent_entity_slug: 'perplexity' }
            ]
        );

        expect(directive.slug).toBe('perplexity');
        expect(directive.person).toBe('Aravind Srinivas');
        expect(directive.source).toBe('brain_entities');
        expect(directive.directive).toContain('person reference');
    });

    it('returns null when no company is known in Brain entities', () => {
        const directive = buildEntityVisualDirectiveFromBrain(
            { raw_title: 'Unknown startup launches a new model' },
            [
                { slug: 'perplexity', name: 'Perplexity', entity_type: 'company', aliases: ['Perplexity AI'] },
                { slug: 'aravind-srinivas', name: 'Aravind Srinivas', entity_type: 'person', parent_entity_slug: 'perplexity' }
            ]
        );

        expect(directive).toBeNull();
    });

    it('returns null when company is known but no person is attached yet', () => {
        const directive = buildEntityVisualDirectiveFromBrain(
            { raw_title: 'Perplexity launches a new AI browser' },
            [
                { slug: 'perplexity', name: 'Perplexity', entity_type: 'company', aliases: ['Perplexity AI'] }
            ]
        );

        expect(directive).toBeNull();
    });
});
