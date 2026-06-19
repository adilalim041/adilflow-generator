function articleSearchText(article) {
    return [
        article?.raw_title,
        article?.title,
        article?.headline,
        article?.raw_summary,
        article?.summary,
        article?.raw_text,
        article?.body,
        article?.url
    ].filter(Boolean).join(' ').toLowerCase();
}

function articleMentions(article, pattern) {
    return pattern.test(articleSearchText(article));
}

function isGovernmentPressureArticle(article) {
    return articleMentions(
        article,
        /\b(government|u\.?\s?s\.?\s?government|usa|white house|trump|administration|washington|export|exports|restriction|restrictions|regulation|regulator|g7|kept online|keep online|forced online)\b/i
    );
}

function replaceKnownModelNameArtifacts(article, headline) {
    let value = String(headline || '');

    if (articleMentions(article, /\bmythos\b/i)) {
        value = value
            .replace(/МИФЫ/gi, 'MYTHOS')
            .replace(/МИФОВ/gi, 'MYTHOS')
            .replace(/МИФАМИ/gi, 'MYTHOS')
            .replace(/МИФОС/gi, 'MYTHOS');
    }

    if (articleMentions(article, /\bfable\b/i)) {
        value = value
            .replace(/БАСНИ/gi, 'FABLE')
            .replace(/БАСЕН/gi, 'FABLE')
            .replace(/ФЕЙБЛ/gi, 'FABLE')
            .replace(/ФЭЙБЛ/gi, 'FABLE');
    }

    return value
        .replace(/ГОВЕРНМЕНТ/gi, 'ПРАВИТЕЛЬСТВО США')
        .replace(/ГАВЕРНМЕНТ/gi, 'ПРАВИТЕЛЬСТВО США');
}

function modelNamesForHeadline(article) {
    const names = [];
    if (articleMentions(article, /\bmythos\b/i)) names.push('MYTHOS');
    if (articleMentions(article, /\bfable\b/i)) names.push('FABLE');
    return names.length ? names.join(' И ') : 'МОДЕЛИ ANTHROPIC';
}

function fixGovernmentPressureAgency(article, headline) {
    const value = String(headline || '').trim();
    if (!value) return value;
    if (!isGovernmentPressureArticle(article)) return value;
    if (!articleMentions(article, /\b(anthropic|claude|mythos|fable)\b/i)) return value;

    const saysAnthropicIsAggressor = /АНТРОПИК\s+(ДУШИТ|ПРИЖАЛ|ЗАПЕР|УДЕРЖИВАЕТ|ДАВИТ)/i.test(value);
    const hasBrokenGovernment = /ПРАВИТЕЛЬСТВО США/i.test(value);
    const hasModelNameArtifact = /\bMYTHOS\b|\bFABLE\b/i.test(value) && /\bДУШИТ\b/i.test(value);

    if (!saysAnthropicIsAggressor && !hasBrokenGovernment && !hasModelNameArtifact) {
        return value;
    }

    return `США **ДАВЯТ НА ANTHROPIC** И ДЕРЖАТ ${modelNamesForHeadline(article)} ОНЛАЙН`;
}

function fixHeadlineArtifacts(article, headline) {
    const withNames = replaceKnownModelNameArtifacts(article, headline);
    return fixGovernmentPressureAgency(article, withNames);
}

module.exports = {
    fixHeadlineArtifacts,
    isGovernmentPressureArticle,
    replaceKnownModelNameArtifacts
};
