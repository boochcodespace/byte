// backend/lib/llm/index.js
//
// The one entry point the rest of Byte uses to talk to a model.
// Dispatches to the adapter named by the resolved config. Adding a new
// adapter means adding a file here and one line below; nothing in the
// artifact types or routes needs to change.

const anthropic = require('./anthropic')
const openaiCompatible = require('./openai-compatible')

const ADAPTERS = {
  anthropic,
  'openai-compatible': openaiCompatible,
}

// config comes from resolveLlmConfig() in ./config.js
async function complete(config, request) {
  const adapter = ADAPTERS[config.adapter]
  if (!adapter) throw new Error(`Unknown LLM adapter: ${config.adapter}`)
  return adapter.complete(config, request)
}

module.exports = { complete }
