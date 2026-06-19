function getBrainContentPlan(article) {
    const plan = article?.scores_detail?.content_plan;
    if (!plan || typeof plan !== 'object') return null;
    const copy = plan.copy || {};
    const visual = plan.visual || {};
    const template = plan.template || {};

    const hasMinimumCopy = copy.headline_ru || copy.caption_ru || visual.image_prompt;
    if (!hasMinimumCopy) return null;

    return {
        headline_ru: copy.headline_ru || '',
        headline2_ru: copy.headline2_ru || '',
        caption_ru: copy.caption_ru || '',
        hashtags: copy.hashtags || '',
        cta_ru: copy.cta_ru || '',
        image_prompt: visual.image_prompt || '',
        angle: visual.angle || 'editorial-satire',
        image_strategy: visual.image_strategy || null,
        use_original_image: visual.image_strategy === 'use_original_if_suitable',
        template_id: template.template_id || null,
        content_plan_source: plan.source || 'brain',
        content_plan_version: plan.version || 1
    };
}

function hasBrainContentPlan(article) {
    return Boolean(getBrainContentPlan(article));
}

module.exports = {
    getBrainContentPlan,
    hasBrainContentPlan
};
