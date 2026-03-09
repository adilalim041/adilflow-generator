/**
 * AdilFlow Generator — Сервис 4
 * Берёт статьи из Мозга → GPT генерирует контент → Image Service делает картинки
 * 
 * Style A: Вирусный, красный (#FF3B30), агрессивный
 * Язык: русский
 * Форматы: обложка, карусель 5 слайдов, Reels
 * Микс: 2 обложки + 2 карусели + 1 Reels в день
 */

const express = require('express');
const app = express();
app.use(express.json());

// ═══════════════════════════════════════
// КОНФИГУРАЦИЯ
// ═══════════════════════════════════════
const BRAIN_URL = process.env.BRAIN_URL || 'https://adilflow-brain-production.up.railway.app';
const BRAIN_API_KEY = process.env.BRAIN_API_KEY || '';
const IMAGE_SERVICE_URL = process.env.IMAGE_SERVICE_URL || 'https://image-overlay-service-production.up.railway.app';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// ═══════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════
app.get('/', (req, res) => {
    res.json({ service: 'AdilFlow Generator', version: '1.0.0', status: 'online' });
});

// ═══════════════════════════════════════
// ГЛАВНЫЙ ЭНДПОИНТ: Сгенерировать контент
// Вызывается по cron или вручную
// ═══════════════════════════════════════
app.post('/api/generate', async (req, res) => {
    try {
        const { niche = 'health_medicine', count = 5 } = req.body || {};

        console.log(`[GENERATE] Starting for niche: ${niche}, count: ${count}`);

        // 1. Получить статьи из Мозга
        const articles = await getArticlesFromBrain(niche, count);
        if (articles.length === 0) {
            return res.json({ success: true, message: 'No articles ready', generated: 0 });
        }
        console.log(`[GENERATE] Got ${articles.length} articles from Brain`);

        // 2. Распределить форматы (2 обложки + 2 карусели + 1 reels)
        const assignments = assignFormats(articles);

        // 3. Для каждой статьи — сгенерировать контент через GPT
        const results = [];
        for (const { article, format } of assignments) {
            try {
                console.log(`[GENERATE] Processing: "${article.raw_title.slice(0, 50)}..." → ${format}`);

                // GPT генерирует текст
                const content = await generateContent(article, format);

                // Image Service делает картинки
                const images = await generateImages(article, content, format);

                // Сохраняем в Мозг
                await saveTorain(article.id, content, images, format);

                results.push({
                    id: article.id,
                    title: article.raw_title.slice(0, 60),
                    format,
                    headline: content.headline_ru,
                    images_count: images.length,
                    success: true
                });

            } catch (e) {
                console.error(`[GENERATE] Error on article ${article.id}: ${e.message}`);
                results.push({ id: article.id, format, success: false, error: e.message });
            }
        }

        console.log(`[GENERATE] Done: ${results.filter(r => r.success).length}/${results.length} successful`);
        res.json({ success: true, generated: results.length, results });

    } catch (e) {
        console.error(`[GENERATE ERROR] ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});


// ═══════════════════════════════════════
// ПОЛУЧИТЬ СТАТЬИ ИЗ МОЗГА
// ═══════════════════════════════════════
async function getArticlesFromBrain(niche, count) {
    const response = await fetch(
        `${BRAIN_URL}/api/articles/ready?niche=${niche}&limit=${count}`,
        { headers: { 'Authorization': `Bearer ${BRAIN_API_KEY}` } }
    );
    const data = await response.json();
    return data.articles || [];
}


// ═══════════════════════════════════════
// РАСПРЕДЕЛЕНИЕ ФОРМАТОВ
// 2 обложки + 2 карусели + 1 reels
// ═══════════════════════════════════════
function assignFormats(articles) {
    // Порядок: лучшая wow статья → reels, следующие → карусели, остальные → обложки
    const sorted = [...articles].sort((a, b) =>
        (b.scores_detail?.wow_factor || 0) - (a.scores_detail?.wow_factor || 0)
    );

    const assignments = [];
    const formats = ['reels', 'carousel', 'carousel', 'cover', 'cover'];

    for (let i = 0; i < Math.min(sorted.length, formats.length); i++) {
        assignments.push({ article: sorted[i], format: formats[i] });
    }

    return assignments;
}


// ═══════════════════════════════════════
// GPT: ГЕНЕРАЦИЯ КОНТЕНТА
// Один промпт на статью, формат зависит от типа
// ═══════════════════════════════════════
async function generateContent(article, format) {
    const systemPrompt = `Ты — контент-мейкер вирусного Instagram канала о здоровье.
Язык: русский.
Стиль: шокирующий, цепляющий, простым языком.
Аудитория: обычные люди 25-55 лет.
Правило: НЕ выдумывай факты. Используй ТОЛЬКО информацию из статьи.
Правило: заголовки КАПСЛОКОМ, максимум 8 слов.
Правило: отвечай ТОЛЬКО валидным JSON, без markdown.`;

    let userPrompt;

    if (format === 'cover') {
        userPrompt = `Создай одиночный Instagram пост по этой статье.

СТАТЬЯ:
${article.raw_title}
${article.raw_text}

Верни JSON:
{
  "headline_ru": "ЗАГОЛОВОК КАПСЛОКОМ (до 8 слов, шокирующий)",
  "headline2_ru": "подзаголовок (до 6 слов)",
  "caption_ru": "Текст поста для Instagram: 3-4 предложения простым языком + факты + эмодзи. Последнее предложение: CTA (сохрани/подпишись/отправь другу). Без хештегов.",
  "hashtags": "#здоровье #медицина #наука #факты #здоровыйобразжизни #лайфхак #полезно #интересно #тело #исследование"
}`;

    } else if (format === 'carousel') {
        userPrompt = `Создай карусель из 5 слайдов для Instagram по этой статье.

СТАТЬЯ:
${article.raw_title}
${article.raw_text}

Верни JSON:
{
  "headline_ru": "ЗАГОЛОВОК КАПСЛОКОМ для обложки (до 8 слов)",
  "headline2_ru": "подзаголовок обложки (до 6 слов)",
  "slide_1_hook": "Шок-фраза на первый слайд (до 6 слов, КАПСЛОК, вызывает желание листать)",
  "slide_2_title": "Заголовок слайда 2 (ФАКТЫ / ЧТО НАШЛИ / и тд)",
  "slide_2_text": "Ключевой факт исследования. 2-3 предложения. Цифры если есть.",
  "slide_2_stat": "Главная цифра (×2.3 / 30% / 50,000 человек) или пустая строка",
  "slide_3_title": "Заголовок слайда 3",
  "slide_3_text": "Что это значит для тела/здоровья. 2-3 предложения простым языком.",
  "slide_4_title": "ЧТО ДЕЛАТЬ",
  "slide_4_tips": ["Совет 1 (конкретный, 1 предложение)", "Совет 2", "Совет 3"],
  "slide_5_cta": "Сохрани и отправь другу 💛",
  "caption_ru": "Текст поста: краткое описание + CTA + эмодзи. Без хештегов.",
  "hashtags": "#здоровье #медицина #наука #факты #полезно #тело #исследование #интересно #здоровыйобразжизни #лайфхак"
}`;

    } else if (format === 'reels') {
        userPrompt = `Создай сценарий Reels (15-20 секунд) по этой статье.

СТАТЬЯ:
${article.raw_title}
${article.raw_text}

Reels = серия кадров по 2-3 секунды с текстом на экране.
Первый кадр — хук (3 секунды, зритель решает смотреть или нет).

Верни JSON:
{
  "headline_ru": "ЗАГОЛОВОК для превью Reels (до 8 слов)",
  "frames": [
    {"text": "Текст на экране кадра 1 — ХУК (до 10 слов, шокирующий)", "duration": 3},
    {"text": "Кадр 2 — факт (до 12 слов)", "duration": 2.5},
    {"text": "Кадр 3 — что это значит (до 12 слов)", "duration": 2.5},
    {"text": "Кадр 4 — ещё факт (до 12 слов)", "duration": 2.5},
    {"text": "Кадр 5 — что делать (до 12 слов)", "duration": 2.5},
    {"text": "Кадр 6 — CTA: подпишись/сохрани (до 8 слов)", "duration": 2}
  ],
  "caption_ru": "Текст поста: 2-3 предложения + CTA + эмодзи. Без хештегов.",
  "hashtags": "#здоровье #reels #медицина #факты #наука #полезно #интересно #здоровыйобразжизни #шок #тело"
}`;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_tokens: 1000,
            temperature: 0.7
        })
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '{}';
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(clean);
}


// ═══════════════════════════════════════
// IMAGE SERVICE: ГЕНЕРАЦИЯ КАРТИНОК
// ═══════════════════════════════════════
async function generateImages(article, content, format) {
    const images = [];

    if (format === 'cover') {
        // Одна обложка: фото + headline
        const imageUrl = article.top_image || '';
        if (imageUrl) {
            const coverUrl = await callImageService('/overlay', {
                imageUrl,
                headline: content.headline_ru,
                headline2: content.headline2_ru
            });
            if (coverUrl) images.push({ type: 'cover', url: coverUrl });
        }
    }

    else if (format === 'carousel') {
        // Слайд 1: обложка с фото
        const imageUrl = article.top_image || '';
        if (imageUrl) {
            const slide1 = await callImageService('/overlay', {
                imageUrl,
                headline: content.slide_1_hook || content.headline_ru,
                headline2: content.headline2_ru || ''
            });
            if (slide1) images.push({ type: 'slide_1', url: slide1 });
        }

        // Слайды 2-4: текстовые карточки
        for (let i = 2; i <= 4; i++) {
            const title = content[`slide_${i}_title`] || '';
            const text = content[`slide_${i}_text`] || (content[`slide_${i}_tips`] || []).join('\n• ');
            if (title || text) {
                const slide = await callImageService('/textcard', {
                    body: `${title}\n\n${text}`,
                    conclusion: content[`slide_${i}_stat`] || ''
                });
                if (slide) images.push({ type: `slide_${i}`, url: slide });
            }
        }

        // Слайд 5: CTA
        const slide5 = await callImageService('/textcard', {
            body: content.slide_5_cta || 'Сохрани и отправь другу!',
            conclusion: '↓ ПОДПИШИСЬ ↓'
        });
        if (slide5) images.push({ type: 'slide_5', url: slide5 });
    }

    else if (format === 'reels') {
        // Каждый фрейм → картинка 1080×1920
        // Пока используем /textcard, потом добавим /instagram/reel-frame
        for (let i = 0; i < (content.frames || []).length; i++) {
            const frame = content.frames[i];
            const frameImg = await callImageService('/textcard', {
                body: frame.text,
                conclusion: ''
            });
            if (frameImg) images.push({ type: `frame_${i}`, url: frameImg, duration: frame.duration });
        }
    }

    return images;
}


async function callImageService(endpoint, body) {
    try {
        const response = await fetch(`${IMAGE_SERVICE_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            // Image service returns raw image, we need to upload to Cloudinary
        });

        if (!response.ok) {
            console.error(`[IMAGE] ${endpoint} failed: ${response.status}`);
            return null;
        }

        // Image service returns JPEG buffer
        // Upload to Cloudinary for permanent URL
        const imageBuffer = await response.arrayBuffer();
        const cloudinaryUrl = await uploadToCloudinary(Buffer.from(imageBuffer));
        return cloudinaryUrl;

    } catch (e) {
        console.error(`[IMAGE] ${endpoint} error: ${e.message}`);
        return null;
    }
}


// ═══════════════════════════════════════
// CLOUDINARY: ЗАГРУЗКА КАРТИНОК
// ═══════════════════════════════════════
async function uploadToCloudinary(imageBuffer) {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'do0zl6hbd';
    const uploadPreset = process.env.CLOUDINARY_PRESET || 'ml_default';

    const formData = new FormData();
    formData.append('file', new Blob([imageBuffer], { type: 'image/jpeg' }));
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', 'adilflow_instagram');

    const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        { method: 'POST', body: formData }
    );

    const data = await response.json();
    return data.secure_url || null;
}


// ═══════════════════════════════════════
// СОХРАНИТЬ РЕЗУЛЬТАТ В МОЗГ
// ═══════════════════════════════════════
async function saveTorain(articleId, content, images, format) {
    const coverImage = images.find(i => i.type === 'cover' || i.type === 'slide_1')?.url || '';

    await fetch(`${BRAIN_URL}/api/articles/${articleId}/generated`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${BRAIN_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            headline: content.headline_ru,
            headline2: content.headline2_ru || '',
            body: content.caption_ru || '',
            conclusion: content.hashtags || '',
            telegram_caption: content.caption_ru,
            cover_image: coverImage,
            card_image: images.map(i => i.url).join(','),
            template_id: `instagram_${format}`
        })
    });
}


// ═══════════════════════════════════════
// ТЕСТОВЫЙ ЭНДПОИНТ: только GPT без картинок
// Для быстрой проверки что генерирует GPT
// ═══════════════════════════════════════
app.post('/api/preview', async (req, res) => {
    try {
        const { niche = 'health_medicine', count = 5 } = req.body || {};

        const articles = await getArticlesFromBrain(niche, count);
        if (articles.length === 0) {
            return res.json({ success: true, message: 'No articles', previews: [] });
        }

        const assignments = assignFormats(articles);
        const previews = [];

        for (const { article, format } of assignments) {
            try {
                const content = await generateContent(article, format);
                previews.push({
                    id: article.id,
                    title: article.raw_title,
                    format,
                    score: article.relevance_score,
                    has_image: article.has_usable_media,
                    top_image: article.top_image,
                    generated: content
                });
            } catch (e) {
                previews.push({ id: article.id, format, error: e.message });
            }
        }

        res.json({ success: true, previews });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// ═══════════════════════════════════════
// ЗАПУСК
// ═══════════════════════════════════════
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    console.log(`AdilFlow Generator v1 on port ${PORT}`);
    console.log(`Brain: ${BRAIN_URL}`);
    console.log(`Image Service: ${IMAGE_SERVICE_URL}`);
});
