// backend/lib/llm/anthropic.js
//
// Adapter for Anthropic's native Messages API. Same behavior Byte had
// before multi-provider support, moved behind the shared adapter
// contract:
//
//   complete(config, { system, user, maxTokens }) → string
//
// Returns the model's text. Errors are thrown as-is; the SDK errors
// carry .status / .name, which mapSdkError in lib/error-types.js
// already understands.

const Anthropic = require('@anthropic-ai/sdk')

async function complete(config, { system, user, maxTokens }) {
  const client = new Anthropic({ apiKey: config.apiKey })
  const response = await client.messages.create({
    model: config.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  })
  // An empty string flows on to JSON.parse, which surfaces as the
  // normal "malformed output, try again" error.
  const block = response.content?.find(b => b.type === 'text')
  return block?.text ?? ''
}

module.exports = { complete }
