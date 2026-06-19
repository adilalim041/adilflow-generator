const { selectMentionedEntity } = require('./entityAssetDiscovery');

function buildEntityVisualDirectiveFromBrain(article, entities) {
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
    buildEntityVisualDirectiveFromBrain
};
