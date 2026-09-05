const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

/**
 * Calls Groq's OpenAI-compatible chat completions endpoint. The API key is
 * read from a server-only environment variable (a Vercel project env var,
 * never a NEXT_PUBLIC_ or VITE_ variable) - it never appears in any response
 * sent to the browser, and this module is never imported by any client-side code.
 */
export async function callGroq({ systemPrompt, userContent, maxTokens = 2000 }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const err = new Error('AI analysis is not configured on the server.');
    err.code = 'missing_api_key';
    throw err;
  }
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;

  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
    });
  } catch (err) {
    const wrapped = new Error('Could not reach the AI analysis service.');
    wrapped.code = 'network_error';
    throw wrapped;
  }

  if (res.status === 401) {
    const err = new Error('AI analysis service rejected the request.');
    err.code = 'auth_error';
    throw err;
  }
  if (res.status === 429) {
    const err = new Error('AI analysis is temporarily rate-limited. Try again shortly.');
    err.code = 'rate_limited';
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('Groq API error', res.status, text.slice(0, 500));
    const err = new Error('AI analysis service returned an error.');
    err.code = 'upstream_error';
    throw err;
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    const err = new Error('AI analysis service returned an empty response.');
    err.code = 'empty_response';
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const wrapped = new Error('AI analysis service returned malformed data.');
    wrapped.code = 'invalid_json';
    throw wrapped;
  }

  return { parsed, model };
}
