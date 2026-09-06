const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// "gemini-flash-latest" is a Google-maintained alias that always points at
// their current fast/cheap Flash model (Gemini 3.5 Flash as of mid-2026),
// so this stays current without needing code changes when Google ships a
// new Flash version. Override with GEMINI_MODEL if you ever want to pin a
// specific version instead.
const DEFAULT_MODEL = 'gemini-flash-latest';

/**
 * Calls Google's Gemini generateContent endpoint and returns parsed JSON,
 * mirroring the shape of callGroq() ({ parsed, model }) so callers don't
 * need to care which provider they're talking to. The API key is read from
 * a server-only environment variable (a Vercel project env var, never a
 * NEXT_PUBLIC_ or VITE_ variable) - it never appears in any response sent
 * to the browser, and this module is never imported by any client-side
 * code.
 */
export async function callGemini({ systemPrompt, userContent, maxTokens = 2000, model: modelOverride, temperature = 0.3 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('AI question generation is not configured on the server.');
    err.code = 'missing_api_key';
    throw err;
  }
  const model = modelOverride || process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `${GEMINI_URL_BASE}/${model}:generateContent?key=${apiKey}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json',
        },
      }),
    });
  } catch (err) {
    const wrapped = new Error('Could not reach the AI question generation service.');
    wrapped.code = 'network_error';
    throw wrapped;
  }

  if (res.status === 401 || res.status === 403) {
    const err = new Error('AI question generation service rejected the request.');
    err.code = 'auth_error';
    throw err;
  }
  if (res.status === 429) {
    const err = new Error('AI question generation is temporarily rate-limited. Try again shortly.');
    err.code = 'rate_limited';
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('Gemini API error', res.status, text.slice(0, 500));
    const err = new Error('AI question generation service returned an error.');
    err.code = 'upstream_error';
    throw err;
  }

  const data = await res.json();

  // A prompt or candidate can be blocked by Gemini's safety filters before
  // any content is produced - surface that distinctly rather than treating
  // it as an empty/malformed response.
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) {
    const err = new Error('AI question generation service blocked this request.');
    err.code = 'blocked';
    throw err;
  }

  const candidate = data?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
    const err = new Error('AI question generation service blocked this response.');
    err.code = 'blocked';
    throw err;
  }

  const content = candidate?.content?.parts?.map((p) => p.text || '').join('');
  if (!content) {
    const err = new Error('AI question generation service returned an empty response.');
    err.code = 'empty_response';
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const wrapped = new Error('AI question generation service returned malformed data.');
    wrapped.code = 'invalid_json';
    throw wrapped;
  }

  return { parsed, model };
}
