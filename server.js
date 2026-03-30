/**
 * AdilFlow Generator — Сервис 3
 * Берет статьи из Brain, генерирует Instagram feed-пост и рендерит обложку через Template Editor.
 */

require('dotenv').config();

const Sentry = require('@sentry/node');
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 0.2
    });
}

const fs = require('fs');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const pino = require('pino');
const pinoHttp = require('pino-http');

const logger = pino({ name: 'adilflow-generator' });

function validate(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) return res.status(400).json({ error: 'Validation failed', details: result.error.issues });
        req.body = result.data;
        next();
    };
}

const GenerateSchema = z.object({
    niche: z.string().min(1).default('health_medicine'),
    count: z.number().int().min(1).max(20).default(1)
}).passthrough();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(pinoHttp({ logger }));
app.use('/api/', rateLimit({ windowMs: 60_000, max: 60, message: { error: 'Too many requests' } }));
app.use('/api/generate', rateLimit({ windowMs: 60_000, max: 20 }));

const BRAIN_URL = process.env.BRAIN_URL || 'https://adilflow-brain-production.up.railway.app';
const BRAIN_API_KEY = process.env.BRAIN_API_KEY || '';
const RENDER_SERVICE_URL = process.env.RENDER_SERVICE_URL || 'http://localhost:3000';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const GENERATOR_API_KEY = process.env.GENERATOR_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const INSTAGRAM_TEMPLATE_ID = process.env.INSTAGRAM_TEMPLATE_ID || 'cover-template-v1';
const GENERATOR_PLATFORM = process.env.GENERATOR_PLATFORM || 'instagram';
const GENERATOR_FORMAT = process.env.GENERATOR_FORMAT || 'feed_post';
const GENERATOR_CHANNEL_KEY = process.env.GENERATOR_CHANNEL_KEY || '';
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'do0zl6hbd';
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
const CLOUDINARY_PRESET = process.env.CLOUDINARY_PRESET || 'ml_default';
const GENERATOR_PLAYBOOK_PATH = process.env.GENERATOR_PLAYBOOK_PATH || path.join(__dirname, 'playbooks', 'instagram-news-core.json');
const templateMetaCache = new Map();
const generationConfigCache = new Map();
let playbookCache = null;

// ═══════════════════════════════════════
// CIRCUIT BREAKER + RETRY
// ═══════════════════════════════════════
class CircuitBreaker {
    constructor({ threshold = 5, resetTimeout = 30000, name = 'circuit' } = {}) {
        this.threshold = threshold;
        this.resetTimeout = resetTimeout;
        this.name = name;
        this.failures = 0;
        this.state = 'CLOSED';
        this.nextAttempt = 0;
    }
    async exec(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                throw new Error(`Circuit breaker [${this.name}] is OPEN — service unavailable`);
            }
            this.state = 'HALF_OPEN';
        }
        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }
    onSuccess() { this.failures = 0; this.state = 'CLOSED'; }
    onFailure() {
        this.failures++;
        if (this.failures >= this.threshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.resetTimeout;
            logger.warn({ breaker: this.name, failures: this.failures }, 'Circuit breaker OPEN');
        }
    }
    getStatus() { return { state: this.state, failures: this.failures }; }
}

async function withRetry(fn, { retries = 2, baseDelay = 1000, maxDelay = 8000 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < retries) {
                const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
                logger.warn({ attempt: attempt + 1, retries, delay, error: error.message }, 'Retrying...');
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

const brainBreaker = new CircuitBreaker({ threshold: 5, resetTimeout: 30000, name: 'brain' });

function authMiddleware(req, res, next) {
    if (!GENERATOR_API_KEY) return next();
    const raw = req.headers.authorization || '';
    const key = raw.replace(/^Bearer\s+/i, '').trim();
    if (key !== GENERATOR_API_KEY) {
        logger.warn({ got: key.slice(0, 8) + '...', expect: GENERATOR_API_KEY.slice(0, 8) + '...' }, 'Auth mismatch');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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

function parseJsonSafely(text) {
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

function isBlank(value) {
    return value == null || (typeof value === 'string' && value.trim() === '');
}

function truncateWords(value, wordLimit) {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean);
    if (words.length <= wordLimit) return words.join(' ');
    return words.slice(0, wordLimit).join(' ');
}

function fallbackCaption(article) {
    const source = article.raw_summary || article.raw_text || '';
    return source.replace(/\s+/g, ' ').trim().slice(0, 420);
}

function loadGeneratorPlaybook() {
    if (playbookCache) return playbookCache;

    try {
        const raw = fs.readFileSync(GENERATOR_PLAYBOOK_PATH, 'utf8');
        playbookCache = JSON.parse(raw);
    } catch (error) {
        console.warn(`[PLAYBOOK] Using built-in defaults: ${error.message}`);
        playbookCache = {
            name: 'Built-in Instagram News Core',
            headlineRules: [
                'Lead with the strongest discovery or consequence.',
                'Keep the main headline punchy and concrete.',
                'Avoid unsupported clickbait.'
            ],
            subheadlineRules: [
                'Use the second line to add one clarifying detail.',
                'Prefer one short readable phrase.'
            ],
            captionRules: [
                'Summarize the article in 3-5 sentences.',
                'Sound human and specific.',
                'Do not invent facts.'
            ],
            imageDecisionRules: [
                'Use the original image when it is human, concrete, and relevant.',
                'Recommend replacement when the source looks like a logo, icon, infographic, or low-value asset.'
            ],
            imagePromptTemplate: 'Editorial Instagram cover for news story: {{title}}. Focus on the key scene or consequence. No text, no watermark, realistic, high contrast.'
        };
    }

    return playbookCache;
}

function normalizePlaybook(playbook) {
    const fallback = loadGeneratorPlaybook();
    if (!playbook) return fallback;

    return {
        ...fallback,
        ...playbook,
        name: playbook.name || fallback.name,
        key: playbook.key || null,
        headlineRules: playbook.headlineRules || playbook.headline_rules || fallback.headlineRules || [],
        subheadlineRules: playbook.subheadlineRules || playbook.subheadline_rules || fallback.subheadlineRules || [],
        captionRules: playbook.captionRules || playbook.caption_rules || fallback.captionRules || [],
        imageDecisionRules: playbook.imageDecisionRules || playbook.image_rules || fallback.imageDecisionRules || [],
        imagePromptTemplate: playbook.imagePromptTemplate || playbook.image_prompt_template || fallback.imagePromptTemplate,
        examples: playbook.examples || fallback.examples || []
    };
}

function chooseTemplateBinding(bindings, format = GENERATOR_FORMAT) {
    const items = Array.isArray(bindings) ? bindings : [];
    return items.find((binding) => binding.format === format)
        || items.find((binding) => !binding.format)
        || items[0]
        || null;
}

function buildFallbackContent(article) {
    const title = (article.raw_title || 'ВАЖНАЯ НОВОСТЬ').replace(/\s+/g, ' ').trim();
    const words = title.split(' ').filter(Boolean);

    return {
        headline_ru: words.slice(0, 5).join(' ').toUpperCase() || 'ВАЖНАЯ НОВОСТЬ',
        headline2_ru: words.slice(5, 9).join(' ') || 'Главное за минуту',
        caption_ru: fallbackCaption(article) || title,
        hashtags: '#новости #инстаграм #медиа #обзор',
        use_original_image: true,
        image_prompt: '',
        angle: 'news'
    };
}

function getSourceImage(article) {
    if (article.top_image) return article.top_image;
    if (Array.isArray(article.images) && article.images.length > 0) return article.images[0];
    if (article.generated_image) return article.generated_image;
    return '';
}

function assessSourceImage(article) {
    const url = getSourceImage(article);
    if (!url) {
        return {
            hasImage: false,
            suitable: false,
            score: 0,
            reasons: ['missing_source_image'],
            recommendation: 'generate_if_available'
        };
    }

    const flags = [];
    if (/\b(logo|icon|avatar|sprite|placeholder|default|banner|adserver)\b/i.test(url)) {
        flags.push('looks_like_asset');
    }
    if (/\.(svg|gif)(\?|$)/i.test(url)) {
        flags.push('unsupported_visual_format');
    }
    if (/thumb|thumbnail|small|120x120|150x150|200x200/i.test(url)) {
        flags.push('looks_like_thumbnail');
    }

    const suitable = flags.length === 0;
    const score = suitable ? 78 : Math.max(15, 78 - (flags.length * 25));

    return {
        hasImage: true,
        suitable,
        score,
        reasons: flags,
        recommendation: suitable ? 'use_original' : 'generate_if_available'
    };
}

function fillTemplateString(template, values) {
    return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');
}

function buildImagePrompt(article, angle, playbook) {
    const template = playbook?.imagePromptTemplate
        || 'Editorial Instagram cover for news story: {{title}}. Realistic scene, no text, no watermark.';
    return fillTemplateString(template, {
        title: article.raw_title || 'news story',
        summary: truncateWords(article.raw_summary || '', 40),
        angle: angle || 'news'
    }).trim();
}

function finalizeGeneratedContent(article, content, playbook, imageAssessment) {
    const merged = { ...buildFallbackContent(article), ...(content || {}) };
    merged.headline_ru = truncateWords((merged.headline_ru || '').toUpperCase(), 6) || 'ВАЖНАЯ НОВОСТЬ';
    merged.headline2_ru = truncateWords(merged.headline2_ru || '', 6);
    merged.caption_ru = (merged.caption_ru || fallbackCaption(article) || article.raw_title || '').trim();
    merged.hashtags = merged.hashtags || '#новости #инстаграм #медиа #обзор';
    merged.image_assessment = imageAssessment;
    merged.image_strategy = imageAssessment.recommendation;
    merged.use_original_image = imageAssessment.hasImage;

    if (imageAssessment.recommendation !== 'use_original' && !merged.image_prompt) {
        merged.image_prompt = buildImagePrompt(article, merged.angle, playbook);
    }

    return merged;
}

function buildTemplateValueMap(article, content) {
    const sourceImage = getSourceImage(article);
    return {
        headline: content.headline_ru || '',
        headline2: content.headline2_ru || '',
        body: content.caption_ru || '',
        conclusion: content.hashtags || '',
        imageUrl: sourceImage,
        image_url: sourceImage,
        sourceImage,
        source_name: article.source_name || '',
        sourceName: article.source_name || '',
        niche: article.niche || '',
        articleUrl: article.url || '',
        article_url: article.url || '',
        rawTitle: article.raw_title || '',
        rawSummary: article.raw_summary || '',
        imagePrompt: content.image_prompt || '',
        generatedImage: article.generated_image || '',
        generated_image: article.generated_image || ''
    };
}

async function renderFetch(path, options = {}) {
    return fetch(`${RENDER_SERVICE_URL}${path}`, options);
}

async function fetchTemplateMeta(templateId) {
    if (templateMetaCache.has(templateId)) {
        return templateMetaCache.get(templateId);
    }

    try {
        const response = await renderFetch(`/api/templates/${templateId}/meta`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            const json = await response.json();
            if (json?.success && json?.data) {
                templateMetaCache.set(templateId, json.data);
                return json.data;
            }
        }
    } catch (error) {
        console.warn(`[TEMPLATE] Could not fetch metadata for ${templateId}: ${error.message}`);
    }

    const fallbackMeta = {
        id: templateId,
        requiredVariables: ['headline', 'headline2', 'imageUrl'],
        renderUrl: `/api/render/${templateId}`,
        previewUrl: `/api/render/${templateId}/preview`
    };
    templateMetaCache.set(templateId, fallbackMeta);
    return fallbackMeta;
}

function buildRenderPayload(article, content, templateMeta) {
    const valueMap = buildTemplateValueMap(article, content);
    const requiredVariables = Array.isArray(templateMeta?.requiredVariables)
        ? templateMeta.requiredVariables
        : ['headline', 'headline2', 'imageUrl'];
    const payload = { _strict: false };
    const missing = [];

    requiredVariables.forEach((variable) => {
        const value = valueMap[variable];
        payload[variable] = value ?? '';
        if (isBlank(value)) missing.push(variable);
    });

    return {
        payload,
        missing,
        requiredVariables,
        resolvedVariables: requiredVariables.reduce((acc, variable) => {
            acc[variable] = payload[variable];
            return acc;
        }, {})
    };
}

async function runTemplateFitCheck(templateId, values) {
    const response = await renderFetch(`/api/templates/${templateId}/fit-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
    });

    const text = await response.text();
    const data = parseJsonSafely(text);
    if (!response.ok) {
        throw new Error(data.error || `Template fit-check failed: ${response.status}`);
    }

    return data?.data || { ok: true, issues: [], checks: [] };
}

async function enforceTemplateFit(article, content, templateMeta) {
    const nextContent = { ...content };
    const editableMap = {
        headline: 'headline_ru',
        headline2: 'headline2_ru'
    };

    for (let attempt = 0; attempt < 6; attempt += 1) {
        const renderInfo = buildRenderPayload(article, nextContent, templateMeta);
        const fit = await runTemplateFitCheck(templateMeta?.id || INSTAGRAM_TEMPLATE_ID, renderInfo.payload);
        if (fit.ok) {
            return { content: nextContent, renderInfo, fit };
        }

        let changed = false;
        for (const issue of fit.issues || []) {
            const field = editableMap[issue.variable];
            if (!field || isBlank(nextContent[field])) continue;

            const currentWords = String(nextContent[field]).trim().split(/\s+/).filter(Boolean);
            if (currentWords.length <= 2) continue;

            const targetWords = Math.max(2, currentWords.length - 1);
            nextContent[field] = truncateWords(nextContent[field], targetWords);
            changed = true;
        }

        if (!changed) {
            return { content: nextContent, renderInfo, fit };
        }
    }

    const finalRenderInfo = buildRenderPayload(article, nextContent, templateMeta);
    const finalFit = await runTemplateFitCheck(templateMeta?.id || INSTAGRAM_TEMPLATE_ID, finalRenderInfo.payload);
    return { content: nextContent, renderInfo: finalRenderInfo, fit: finalFit };
}

async function brainFetch(path, options = {}) {
    return brainBreaker.exec(() => withRetry(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(`${BRAIN_URL}${path}`, {
                ...options,
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${BRAIN_API_KEY}`,
                    'Content-Type': 'application/json',
                    ...(options.headers || {})
                }
            });
            const text = await response.text();
            const data = parseJsonSafely(text);
            if (!response.ok) {
                throw new Error(data.error || `Brain request failed: ${response.status}`);
            }
            return data;
        } finally {
            clearTimeout(timeout);
        }
    }, { retries: 2, baseDelay: 1000 }));
}

async function getArticlesFromBrain(niche, count) {
    const data = await brainFetch(`/api/articles/ready?niche=${encodeURIComponent(niche)}&limit=${count}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
    });
    return Array.isArray(data.articles) ? data.articles : [];
}

async function fetchGenerationConfig(niche) {
    const cacheKey = `${GENERATOR_PLATFORM}:${niche}:${GENERATOR_CHANNEL_KEY || 'default'}:${GENERATOR_FORMAT}`;
    if (generationConfigCache.has(cacheKey)) {
        return generationConfigCache.get(cacheKey);
    }

    try {
        const query = new URLSearchParams({
            niche,
            platform: GENERATOR_PLATFORM
        });
        if (GENERATOR_CHANNEL_KEY) query.set('channel_key', GENERATOR_CHANNEL_KEY);

        const data = await brainFetch(`/api/config/resolve?${query.toString()}`, { method: 'GET' });
        const config = data?.config || {};
        const templateBinding = chooseTemplateBinding(config.template_bindings, GENERATOR_FORMAT);
        const resolved = {
            source: templateBinding || config.playbook || config.channel_profile ? 'brain' : 'fallback',
            channelProfile: config.channel_profile || null,
            playbook: normalizePlaybook(config.playbook),
            templateBinding,
            templateId: templateBinding?.template_id || INSTAGRAM_TEMPLATE_ID
        };
        generationConfigCache.set(cacheKey, resolved);
        return resolved;
    } catch (error) {
        console.warn(`[CONFIG] Falling back to local defaults for niche ${niche}: ${error.message}`);
        const resolved = {
            source: 'fallback',
            channelProfile: null,
            playbook: loadGeneratorPlaybook(),
            templateBinding: null,
            templateId: INSTAGRAM_TEMPLATE_ID
        };
        generationConfigCache.set(cacheKey, resolved);
        return resolved;
    }
}

async function markArticleFailed(articleId, message) {
    try {
        await brainFetch(`/api/articles/${articleId}/failed`, {
            method: 'POST',
            body: JSON.stringify({
                stage: 'generator',
                error_message: message
            })
        });
    } catch (error) {
        console.error(`[FAILED] Could not release article ${articleId}: ${error.message}`);
    }
}

async function saveToBrain(articleId, content, coverImage, templateMeta, renderInfo, generationConfig) {
    return brainFetch(`/api/articles/${articleId}/generated`, {
        method: 'POST',
        body: JSON.stringify({
            headline: content.headline_ru,
            headline2: content.headline2_ru || '',
            body: content.caption_ru || '',
            conclusion: content.hashtags || '',
            telegram_caption: content.caption_ru || '',
            image_prompt: content.image_prompt || '',
            generated_image: '',
            cover_image: coverImage,
            card_image: coverImage,
            template_id: templateMeta?.id || INSTAGRAM_TEMPLATE_ID,
            scores_detail: {
                generator_format: 'instagram_image_post',
                generator_angle: content.angle || 'news',
                used_original_image: content.use_original_image !== false,
                generator_config_source: generationConfig?.source || 'fallback',
                channel_profile_key: generationConfig?.channelProfile?.key || null,
                playbook_key: generationConfig?.playbook?.key || null,
                template_binding_id: generationConfig?.templateBinding?.id || null,
                image_strategy: content.image_strategy || 'use_original',
                image_assessment: content.image_assessment || null,
                template_required_variables: renderInfo?.requiredVariables || [],
                template_missing_variables: renderInfo?.missing || [],
                template_fit_ok: renderInfo?.fit?.ok !== false,
                template_fit_issues: renderInfo?.fit?.issues || [],
                template_text_adjustments: renderInfo?.adjustments || []
            }
        })
    });
}

async function generateContent(article, generationConfig = null) {
    const playbook = normalizePlaybook(generationConfig?.playbook);
    const imageAssessment = assessSourceImage(article);

    if (!OPENAI_API_KEY) {
        return finalizeGeneratedContent(article, {}, playbook, imageAssessment);
    }

    const systemPrompt = [
        '?? AI-?????????? ?????????? Instagram ??????.',
        '?????? ?????? ?? ???????.',
        '?????? ?????????? ?????, ???????? ?????? ?? ??????.',
        '????? ???? ??????? feed-???? ? ????? ?????????.',
        '?????????: ?? 6 ????, ???????.',
        '????????????: ?? 6 ????.',
        'Caption: 3-5 ???????????, ????? ????, ??? ????.',
        '????? ?????? ???????? JSON ??? markdown.',
        `Marketing playbook: ${JSON.stringify({
            headlineRules: playbook.headlineRules || [],
            subheadlineRules: playbook.subheadlineRules || [],
            captionRules: playbook.captionRules || [],
            imageDecisionRules: playbook.imageDecisionRules || [],
            examples: playbook.examples || []
        })}`
    ].join(' ');

    const userPrompt = `??????:
?????????: ${article.raw_title}
??????? ????????: ${article.raw_summary || ''}
?????: ${(article.raw_text || '').slice(0, 6000)}
???? ????????: ${article.top_image ? 'yes' : 'no'}
?????? ???????? ????????: ${JSON.stringify(imageAssessment)}

????? JSON:
{
  "headline_ru": "??????? ?? 6 ????",
  "headline2_ru": "???????????? ?? 6 ????",
  "caption_ru": "3-5 ??????????? ??? Instagram ????? ??? ????????",
  "hashtags": "#???1 #???2 #???3",
  "use_original_image": true,
  "image_prompt": "???? ???????? ?????? ?????, ???????? ?????? ??? ????????? ???????????, ????? ?????? ??????",
  "angle": "????? ???? ?????? ??????: shock | useful | breakthrough | explain"
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}` ,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.5,
            max_tokens: 700,
            response_format: { type: 'json_object' }
        })
    });

    const data = await response.json();
    if (!response.ok) {
        console.warn(`[OPENAI] Falling back to local copy for article ${article.id}: ${data.error?.message || response.status}`);
        return finalizeGeneratedContent(article, {}, playbook, imageAssessment);
    }

    const text = data.choices?.[0]?.message?.content || '{}';
    try {
        return finalizeGeneratedContent(article, extractJson(text), playbook, imageAssessment);
    } catch (error) {
        console.warn(`[OPENAI] Invalid JSON for article ${article.id}, using fallback: ${error.message}`);
        return finalizeGeneratedContent(article, {}, playbook, imageAssessment);
    }
}

async function renderCover(article, content, templateMeta) {
    const renderInfo = buildRenderPayload(article, content, templateMeta);
    if (renderInfo.missing.includes('imageUrl')) {
        throw new Error(`Template '${templateMeta?.id || INSTAGRAM_TEMPLATE_ID}' requires imageUrl, but article has no usable image`);
    }

    const response = await renderFetch(templateMeta?.renderUrl || `/api/render/${INSTAGRAM_TEMPLATE_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(renderInfo.payload)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Render service failed: ${response.status} ${text}`.trim());
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const coverImage = await uploadToCloudinary(imageBuffer, 'image/png');
    return { coverImage, renderInfo };
}

function cloneContent(content) {
    return {
        ...content,
        headline_ru: content.headline_ru || '',
        headline2_ru: content.headline2_ru || ''
    };
}

async function prepareTemplateRender(article, content, templateMeta) {
    const workingContent = cloneContent(content);
    const adjustments = [];

    const initialRenderInfo = buildRenderPayload(article, workingContent, templateMeta);
    if (initialRenderInfo.missing.includes('imageUrl')) {
        initialRenderInfo.fit = {
            ok: false,
            issues: [{
                variable: 'imageUrl',
                reason: 'missing_required_value'
            }],
            checks: []
        };
        initialRenderInfo.adjustments = adjustments;
        return { content: workingContent, renderInfo: initialRenderInfo };
    }

    const fitResult = await enforceTemplateFit(article, workingContent, templateMeta);
    ['headline_ru', 'headline2_ru'].forEach((field) => {
        if ((content[field] || '') !== (fitResult.content[field] || '')) {
            adjustments.push({
                field,
                from: content[field] || '',
                to: fitResult.content[field] || ''
            });
        }
    });

    fitResult.renderInfo.fit = fitResult.fit;
    fitResult.renderInfo.adjustments = adjustments;
    return {
        content: fitResult.content,
        renderInfo: fitResult.renderInfo
    };
}

async function uploadToCloudinary(imageBuffer, mimeType = 'image/png') {
    const formData = new FormData();
    formData.append('file', new Blob([imageBuffer], { type: mimeType }));
    formData.append('folder', 'adilflow_instagram');

    if (CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
        // Signed upload — secure, requires API key + secret
        const crypto = require('crypto');
        const timestamp = Math.floor(Date.now() / 1000);
        const paramsToSign = `folder=adilflow_instagram&timestamp=${timestamp}`;
        const signature = crypto.createHash('sha1')
            .update(paramsToSign + CLOUDINARY_API_SECRET)
            .digest('hex');
        formData.append('timestamp', String(timestamp));
        formData.append('api_key', CLOUDINARY_API_KEY);
        formData.append('signature', signature);
    } else {
        // Fallback to unsigned upload (for local dev only)
        console.warn('[Cloudinary] WARNING: Using unsigned upload. Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET for production.');
        formData.append('upload_preset', CLOUDINARY_PRESET);
    }

    const response = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
        { method: 'POST', body: formData }
    );

    const data = await response.json();
    if (!response.ok || !data.secure_url) {
        throw new Error(data.error?.message || 'Cloudinary upload failed');
    }

    return data.secure_url;
}

async function processArticle(article, generationConfig) {
    const activeConfig = generationConfig || await fetchGenerationConfig(article.niche || 'health_medicine');
    const templateId = activeConfig?.templateId || INSTAGRAM_TEMPLATE_ID;
    const content = await generateContent(article, activeConfig);
    const templateMeta = await fetchTemplateMeta(templateId);
    const prepared = await prepareTemplateRender(article, content, templateMeta);

    if (prepared.renderInfo.fit?.ok === false) {
        const issueSummary = (prepared.renderInfo.fit.issues || [])
            .map((issue) => issue.variable || issue.layerName || 'unknown')
            .join(', ');
        throw new Error(`Template fit-check failed for ${templateMeta?.id || templateId}: ${issueSummary}`);
    }

    const { coverImage } = await renderCover(article, prepared.content, templateMeta);
    await saveToBrain(article.id, prepared.content, coverImage, templateMeta, prepared.renderInfo, activeConfig);

    return {
        id: article.id,
        title: (article.raw_title || '').slice(0, 80),
        success: true,
        config_source: activeConfig?.source || 'fallback',
        channel_profile_key: activeConfig?.channelProfile?.key || null,
        playbook_key: activeConfig?.playbook?.key || null,
        template_id: templateMeta?.id || templateId,
        headline: prepared.content.headline_ru,
        required_variables: prepared.renderInfo.requiredVariables,
        fit_ok: prepared.renderInfo.fit?.ok !== false,
        fit_adjustments: prepared.renderInfo.adjustments || [],
        cover_image: coverImage
    };
}

app.get('/', (req, res) => {
    res.json({
        service: 'AdilFlow Generator',
        version: '2.0.0',
        status: 'online',
        render_service: RENDER_SERVICE_URL,
        template_id: INSTAGRAM_TEMPLATE_ID,
        platform: GENERATOR_PLATFORM,
        format: GENERATOR_FORMAT,
        channel_key: GENERATOR_CHANNEL_KEY || null
    });
});

app.get('/health', async (req, res) => {
    const checks = { brain: false, render: false };
    try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5000);
        const brainResp = await fetch(`${BRAIN_URL}/health`, { signal: controller.signal });
        checks.brain = brainResp.ok;
    } catch { /* brain unreachable */ }
    try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 5000);
        const renderResp = await fetch(`${RENDER_SERVICE_URL}/api/health`, { signal: controller.signal });
        checks.render = renderResp.ok;
    } catch { /* render unreachable */ }
    const ok = checks.brain && checks.render;
    res.status(ok ? 200 : 503).json({
        status: ok ? 'ok' : 'degraded',
        uptime: process.uptime(),
        brain_circuit: brainBreaker.getStatus(),
        dependencies: checks
    });
});

app.post('/api/generate', authMiddleware, validate(GenerateSchema), async (req, res) => {
    try {
        const { niche = 'health_medicine', count = 3 } = req.body || {};
        const articles = await getArticlesFromBrain(niche, count);
        const generationConfig = await fetchGenerationConfig(niche);

        if (!articles.length) {
            return res.json({ success: true, generated: 0, results: [], message: 'No articles ready' });
        }

        const results = [];
        for (const article of articles) {
            try {
                console.log(`[GENERATE] ${article.id} -> ${article.raw_title}`);
                results.push(await processArticle(article, generationConfig));
                await sleep(250);
            } catch (error) {
                console.error(`[GENERATE] ${article.id} failed: ${error.message}`);
                await markArticleFailed(article.id, error.message);
                results.push({
                    id: article.id,
                    title: (article.raw_title || '').slice(0, 80),
                    success: false,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            generated: results.filter(item => item.success).length,
            failed: results.filter(item => !item.success).length,
            config_source: generationConfig?.source || 'fallback',
            template_id: generationConfig?.templateId || INSTAGRAM_TEMPLATE_ID,
            results
        });
    } catch (error) {
        console.error(`[GENERATE ERROR] ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/preview', authMiddleware, async (req, res) => {
    try {
        const { niche = 'health_medicine', count = 2 } = req.body || {};
        const articles = await getArticlesFromBrain(niche, count);
        const generationConfig = await fetchGenerationConfig(niche);
        const previews = [];

        for (const article of articles) {
            const generated = await generateContent(article, generationConfig);
            const templateMeta = await fetchTemplateMeta(generationConfig?.templateId || INSTAGRAM_TEMPLATE_ID);
            const prepared = await prepareTemplateRender(article, generated, templateMeta);
            previews.push({
                id: article.id,
                title: article.raw_title,
                source_image: getSourceImage(article),
                config_source: generationConfig?.source || 'fallback',
                channel_profile_key: generationConfig?.channelProfile?.key || null,
                playbook_key: generationConfig?.playbook?.key || null,
                template_id: templateMeta?.id || generationConfig?.templateId || INSTAGRAM_TEMPLATE_ID,
                template_required_variables: prepared.renderInfo.requiredVariables,
                template_missing_variables: prepared.renderInfo.missing,
                template_fit_ok: prepared.renderInfo.fit?.ok !== false,
                template_fit_issues: prepared.renderInfo.fit?.issues || [],
                template_text_adjustments: prepared.renderInfo.adjustments || [],
                image_strategy: prepared.content.image_strategy || 'use_original',
                image_assessment: prepared.content.image_assessment || null,
                image_prompt: prepared.content.image_prompt || '',
                render_payload: prepared.renderInfo.resolvedVariables,
                resolved_config: {
                    source: generationConfig?.source || 'fallback',
                    template_binding: generationConfig?.templateBinding || null
                },
                generated,
                generated_adjusted: prepared.content
            });
        }

        res.json({ success: true, previews });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Sentry error handler (must be after all routes)
if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
}

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    logger.info(`AdilFlow Generator v2 on port ${PORT}`);
    logger.info(`Brain: ${BRAIN_URL}`);
    logger.info(`Render Service: ${RENDER_SERVICE_URL}`);
});
