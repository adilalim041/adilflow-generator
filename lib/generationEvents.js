/**
 * generationEvents.js
 * Fire-and-forget helper for logging AI generation calls to Brain.
 *
 * Design contract:
 *   - NEVER throws or rejects into the caller. Logging failure = Pino warn + continue.
 *   - NEVER awaited in the hot path — caller does logEvent(...).catch(() => {}).
 *   - Truncates prompt to 20000 chars and response to 10000 chars before sending.
 *   - 3-second AbortController timeout on the fetch.
 *   - articleId must be present — skip silently (+ warn) if not.
 *
 * Brain endpoint: POST /api/generation-events
 * Auth header:    x-api-key: BRAIN_API_KEY
 */

'use strict';

const BRAIN_URL = process.env.BRAIN_URL || 'https://adilflow-brain-production.up.railway.app';
const BRAIN_API_KEY = process.env.BRAIN_API_KEY || '';

const PROMPT_MAX_CHARS = 20000;
const RESPONSE_MAX_CHARS = 10000;
const TIMEOUT_MS = 3000;

/**
 * Truncates a string field to maxLen, appending '...[truncated]' when cut.
 * Returns the original value unchanged if it fits.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncateStr(str, maxLen) {
    if (typeof str !== 'string') return str;
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + '...[truncated]';
}

/**
 * Recursively truncate all string leaves of a JSON-serialisable object.
 * Objects/arrays are traversed; primitives other than string are returned as-is.
 * @param {unknown} value
 * @param {number} maxLen
 * @returns {unknown}
 */
function truncateDeep(value, maxLen) {
    if (typeof value === 'string') return truncateStr(value, maxLen);
    if (Array.isArray(value)) return value.map(v => truncateDeep(v, maxLen));
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = truncateDeep(v, maxLen);
        }
        return out;
    }
    return value;
}

/**
 * Log a single AI generation event to Brain.
 *
 * This function is intentionally fire-and-forget:
 *   logEvent({ ... }).catch(err => logger.warn({ err }, 'logEvent failed'));
 *
 * Caller must NOT await this in the main pipeline.
 *
 * @param {object} params
 * @param {number|string}  params.articleId   - article.id (required; skipped if falsy)
 * @param {string}         params.kind        - 'copy' | 'image_prompt' | 'caption_regen' | 'classify'
 * @param {string}         params.provider    - 'openai' | 'gemini'
 * @param {string}         [params.model]     - model identifier string
 * @param {object}         params.prompt      - prompt payload ({ system, user } or { prompt })
 * @param {object|null}    params.response    - parsed model response (null on error)
 * @param {string}         params.outcome     - 'ok' | 'error' | 'fallback'
 * @param {string|null}    [params.error]     - error message when outcome='error'
 * @param {number}         [params.latencyMs] - wall-clock time of the AI call
 * @param {object}         [opts]
 * @param {function}       [opts.fetchFn]     - injectable fetch for testing
 * @param {object}         [opts.logger]      - injectable pino logger for testing
 * @returns {Promise<void>}
 */
async function logEvent(params, opts = {}) {
    const {
        articleId,
        kind,
        provider,
        model = null,
        prompt,
        response = null,
        outcome,
        error = null,
        latencyMs = null
    } = params;

    const fetchFn = opts.fetchFn || fetch;
    const log = opts.logger || null; // caller passes logger; silence if absent

    // Guard: article_id is NOT NULL in the DB schema — skip rather than corrupt data.
    if (!articleId) {
        if (log) {
            log.warn({ kind, provider }, 'logEvent: articleId missing — skipping generation event');
        }
        return;
    }

    // Truncate prompt strings before serialising (could be large playbook prompts).
    const safeprompt = truncateDeep(prompt, PROMPT_MAX_CHARS);

    // Truncate response. Special case: never store base64 blobs even if caller passes them.
    const safeResponse = response !== null ? truncateDeep(response, RESPONSE_MAX_CHARS) : null;

    const body = JSON.stringify({
        article_id: Number(articleId),
        kind,
        provider,
        model,
        prompt: safeprompt,
        response: safeResponse,
        outcome,
        error: error ? String(error).slice(0, 2000) : null,
        latency_ms: latencyMs != null ? Math.round(latencyMs) : null
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetchFn(`${BRAIN_URL}/api/generation-events`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': BRAIN_API_KEY
            },
            body
        });

        clearTimeout(timer);

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            if (log) {
                log.warn(
                    { articleId, kind, provider, status: res.status, responseBody: text.slice(0, 300) },
                    'logEvent: Brain returned non-2xx — generation event not stored'
                );
            }
        }
    } catch (err) {
        clearTimeout(timer);
        // AbortError (timeout) or network error — both are non-fatal.
        if (log) {
            log.warn(
                { articleId, kind, provider, errName: err.name, errMsg: err.message },
                'logEvent: fetch failed — generation event dropped'
            );
        }
    }
}

module.exports = { logEvent };
