/**
 * captionUniqueness.js
 * Helper for checking caption uniqueness via Brain embedding endpoint.
 * Fail-open: any network/5xx error returns { unique: true, check_failed: true }.
 */

'use strict';

const BRAIN_URL = process.env.BRAIN_URL || 'https://adilflow-brain-production.up.railway.app';
const BRAIN_API_KEY = process.env.BRAIN_API_KEY || '';

/**
 * Angle rotation table for regen: if caption is duplicate, switch to the next angle.
 * Cycles: shock → useful → breakthrough → explain → shock
 */
const ANGLE_ROTATION = {
    shock: 'useful',
    useful: 'breakthrough',
    breakthrough: 'explain',
    explain: 'shock'
};

/**
 * Returns the next angle in the rotation for a given angle.
 * Falls back to 'explain' if angle not in the rotation table.
 * @param {string} angle
 * @returns {string}
 */
function nextAngle(angle) {
    return ANGLE_ROTATION[angle] || 'explain';
}

/**
 * Check caption uniqueness against Brain's embedding similarity endpoint.
 *
 * Wraps the call with:
 *   - 2 retry attempts (base delay 500ms, exponential backoff)
 *   - 5-second AbortSignal timeout per attempt
 *
 * Fail-open contract:
 *   - On any exception (network, timeout, JSON parse) → { unique: true, check_failed: true }
 *   - On HTTP 5xx → { unique: true, check_failed: true }
 *   - On HTTP 200 { unique: false, ... } → propagate as-is
 *   - On HTTP 200 { unique: true, ... } → propagate as-is
 *
 * @param {string} caption - The caption_ru text to check
 * @param {number|string|null} articleId - exclude_article_id (current article)
 * @param {object} [opts]
 * @param {string} [opts.brainUrl] - override Brain URL (for testing)
 * @param {string} [opts.brainApiKey] - override Brain API key (for testing)
 * @param {function} [opts.fetchFn] - override global fetch (for testing)
 * @returns {Promise<{
 *   unique: boolean,
 *   check_failed?: boolean,
 *   similarity?: number,
 *   closest_similarity?: number,
 *   matched_article_id?: number,
 *   matched_niche?: string,
 *   matched_caption_preview?: string,
 *   embedding_failed?: boolean
 * }>}
 */
async function checkCaptionUniqueness(caption, articleId, opts = {}) {
    const brainUrl = opts.brainUrl || BRAIN_URL;
    const apiKey = opts.brainApiKey || BRAIN_API_KEY;
    const fetchFn = opts.fetchFn || fetch;

    const body = JSON.stringify({
        caption,
        exclude_article_id: articleId != null ? Number(articleId) : undefined
    });

    const MAX_ATTEMPTS = 2;
    const BASE_DELAY_MS = 500;
    const TIMEOUT_MS = 5000;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
            const response = await fetchFn(`${brainUrl}/api/captions/check-similarity`, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body
            });

            clearTimeout(timer);

            // 5xx → fail-open (embedding provider failed)
            if (response.status >= 500) {
                return { unique: true, check_failed: true };
            }

            // Any non-ok that is not 5xx (e.g. 4xx) → also fail-open
            // Endpoint shouldn't 4xx valid captions, but protect against surprises.
            if (!response.ok) {
                return { unique: true, check_failed: true };
            }

            const data = await response.json();
            return data;

        } catch (_err) {
            clearTimeout(timer);

            // On last attempt, give up
            if (attempt === MAX_ATTEMPTS) break;

            // Exponential backoff before retry: 500ms → 1000ms
            const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // All attempts exhausted — fail-open, never block the pipeline
    return { unique: true, check_failed: true };
}

module.exports = { checkCaptionUniqueness, nextAngle, ANGLE_ROTATION };
