const { selectMentionedEntity } = require('./entityAssetDiscovery');

function slugFromName(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function buildEntityVisualDirectiveFromArticleBrief(article, entities) {
    const briefEntities = article?.scores_detail?.article_brief?.entities || {};
    const mainCompany = String(briefEntities.main_company || '').trim();
    const people = Array.isArray(briefEntities.main_people) ? briefEntities.main_people : [];
    const personName = String(people[0] || '').trim();
    if (!mainCompany || !personName) return null;

    const knownCompany = (entities || []).find(entity => {
        if (entity?.entity_type !== 'company') return false;
        const names = [entity.name, entity.slug, ...(entity.aliases || [])]
            .filter(Boolean)
            .map(item => String(item).toLowerCase());
        return names.includes(mainCompany.toLowerCase());
    });
    const slug = knownCompany?.slug || slugFromName(mainCompany);
    if (!slug) return null;

    return {
        slug,
        person: personName,
        source: 'article_brief',
        directive: `Feature ${personName} as the central recognizable public figure in a symbolic editorial scene connected to this ${mainCompany} story. Use the person reference if available for facial identity, but create a new satirical editorial metaphor scene rather than a documentary photo.`
    };
}

function buildEntityVisualDirectiveFromBrain(article, entities) {
    const articleBriefDirective = buildEntityVisualDirectiveFromArticleBrief(article, entities);
    if (articleBriefDirective) return articleBriefDirective;

    const company = selectMentionedEntity(article, entities || []);
    if (!company?.slug) return null;

    const person = (entities || []).find(entity =>
        entity?.entity_type === 'person'
        && entity?.parent_entity_slug === company.slug
        && entity?.name
    );
    if (!person?.name) return null;

    return {
        slug: company.slug,
        person: person.name,
        source: 'brain_entities',
        directive: `Feature ${person.name} as the central recognizable public figure in a symbolic editorial scene connected to this ${company.name || company.slug} story. Use the person reference if available for facial identity, but create a new satirical editorial metaphor scene rather than a documentary photo.`
    };
}

module.exports = {
    buildEntityVisualDirectiveFromArticleBrief,
    buildEntityVisualDirectiveFromBrain
};
