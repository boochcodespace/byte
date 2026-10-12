// backend/lib/llm/openai-compatible.js
//
// Adapter for any server that speaks the OpenAI chat-completions
// format: OpenAI, Gemini (via its OpenAI-compatible endpoint),
// OpenRouter, Groq, and local servers such as Ollama or LM Studio.
// Uses Node's built-in fetch, so there is no extra dependency.
//
//   complete(config, { system, user, maxTokens }) → string
//
// HTTP failures are thrown as an Error carrying .status so the shared
// mapSdkError can classify them (401/403 key, 404 model, 429 rate
// limit, 5xx server). Transport failures (server down, DNS, timeout)
// surface as fetch errors that mapSdkError already maps to "network".

const REQUEST_TIMEOUT_MS = 120_000

class ProviderHttpError extends Error {
  constructor(status, detail) {
    super(`Provider returned HTTP ${status}${detail ? `: ${detail}` : ''}`)
    this.name = 'ProviderHttpError'
    this.status = status
  }
}

async function complete(config, { system, user, maxTokens }) {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`

  const headers = { 'Content-Type': 'application/json' }
  // Local servers run without a key; sending an empty Bearer header
  // is rejected by some, so only send it when there is one.
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    [config.maxTokensParam]: maxTokens,
  }
  // JSON mode makes the provider enforce valid JSON. Only turned on for
  // providers known to support it; an unsupported parameter would turn
  // into a request error instead of an improvement.
  if (config.jsonMode) body.response_format = { type: 'json_object' }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const errBody = await res.json()
      detail = errBody?.error?.message || errBody?.message || ''
    } catch {
      // non-JSON error body; the status alone is enough
    }
    throw new ProviderHttpError(res.status, detail)
  }

  const data = await res.json()
  // Empty string flows on to JSON.parse → normal "malformed output" error.
  return data?.choices?.[0]?.message?.content ?? ''
}

module.exports = { complete }
