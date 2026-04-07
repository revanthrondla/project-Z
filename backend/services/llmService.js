/**
 * LLM Service — provider-agnostic wrapper for AI chat completions with tool use.
 *
 * Supports:
 *   - Anthropic (claude-*)
 *   - OpenAI    (gpt-*)
 *
 * Normalised response shape (always returned):
 * {
 *   finalText: string,
 *   toolCalls: [{ name, input, result }],   // executed tool calls
 * }
 *
 * Tool definitions are passed in Anthropic format (input_schema) and are
 * automatically translated to OpenAI format (parameters / JSON Schema) when
 * an OpenAI provider is used.
 */

const PROVIDER_MODELS = {
  anthropic: [
    { id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5  — fast & efficient',   tier: 'fast'     },
    { id: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6 — balanced',            tier: 'balanced' },
    { id: 'claude-opus-4-6',            label: 'Claude Opus 4.6   — most capable',        tier: 'powerful' },
  ],
  openai: [
    { id: 'gpt-4o-mini',   label: 'GPT-4o Mini — fast & cheap',   tier: 'fast'     },
    { id: 'gpt-4o',        label: 'GPT-4o      — balanced',        tier: 'balanced' },
    { id: 'o1-mini',       label: 'o1 Mini     — reasoning',       tier: 'powerful' },
  ],
};

// ── Anthropic adapter ─────────────────────────────────────────────────────────

async function anthropicChat({ apiKey, model, systemPrompt, messages, tools, maxTokens = 1500 }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  let finalText = '';
  const toolCalls = [];
  let currentMessages = [...messages];
  const MAX_ROUNDS = 5;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const resp = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      tools,
      messages: currentMessages,
    });

    for (const block of resp.content) {
      if (block.type === 'text') finalText += block.text;
    }

    if (resp.stop_reason !== 'tool_use') break;

    const toolUseBlocks = resp.content.filter(b => b.type === 'tool_use');
    if (!toolUseBlocks.length) break;

    // Caller executes tools; we collect results here via the callback
    const toolResults = [];
    for (const tu of toolUseBlocks) {
      toolCalls.push({ name: tu.name, input: tu.input });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: '__PENDING__',   // caller fills this in
        _name: tu.name,
        _input: tu.input,
      });
    }

    // Signal caller to execute tools, get results, then continue
    return { _needsToolExecution: true, toolResults, currentMessages, finalText, toolCalls, _client: client, _model: model, _systemPrompt: systemPrompt, _tools: tools, _maxTokens: maxTokens };
  }

  return { finalText, toolCalls };
}

// ── OpenAI adapter ────────────────────────────────────────────────────────────

/** Convert Anthropic-style tool defs to OpenAI function format */
function toOpenAITools(anthropicTools) {
  return anthropicTools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/** Convert Anthropic message history to OpenAI format */
function toOpenAIMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
    } else if (Array.isArray(m.content)) {
      // Tool result messages from Anthropic format
      for (const block of m.content) {
        if (block.type === 'tool_result') {
          out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content });
        }
        // Skip tool_use blocks — already handled in assistant turn
      }
    }
  }
  return out;
}

async function openaiChat({ apiKey, model, systemPrompt, messages, tools, maxTokens = 1500 }) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey });
  const openAITools = toOpenAITools(tools);

  let finalText = '';
  const toolCalls = [];
  const oaiMessages = [
    { role: 'system', content: systemPrompt },
    ...toOpenAIMessages(messages),
  ];
  const MAX_ROUNDS = 5;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const resp = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      tools: openAITools.length ? openAITools : undefined,
      tool_choice: openAITools.length ? 'auto' : undefined,
      messages: oaiMessages,
    });

    const choice = resp.choices[0];
    if (choice.message.content) finalText += choice.message.content;

    if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls?.length) break;

    // Execute tools
    oaiMessages.push({ role: 'assistant', content: choice.message.content || null, tool_calls: choice.message.tool_calls });

    const pending = choice.message.tool_calls.map(tc => ({
      _name: tc.function.name,
      _input: JSON.parse(tc.function.arguments || '{}'),
      tool_call_id: tc.id,
    }));

    return {
      _needsToolExecution: true,
      toolResults: pending,
      currentMessages: oaiMessages,
      finalText,
      toolCalls,
      _provider: 'openai',
      _client: client,
      _model: model,
      _systemPrompt: systemPrompt,
      _tools: openAITools,
      _maxTokens: maxTokens,
    };
  }

  return { finalText, toolCalls };
}

// ── Main unified agentic loop ─────────────────────────────────────────────────
/**
 * Run the full agentic loop:
 *  1. Call the LLM
 *  2. Execute any tool calls via the `executeTool` callback
 *  3. Continue until stop_reason is end_turn / no more tools
 *
 * @param {object} opts
 * @param {string}   opts.provider       - 'anthropic' | 'openai'
 * @param {string}   opts.apiKey         - API key for the provider
 * @param {string}   opts.model          - model ID
 * @param {string}   opts.systemPrompt   - system prompt
 * @param {array}    opts.messages        - conversation history (Anthropic format)
 * @param {array}    opts.tools           - tool definitions (Anthropic format)
 * @param {function} opts.executeTool     - (name, input) => result object
 * @param {number}   [opts.maxTokens]
 * @returns {Promise<{ finalText: string, toolCallsAccum: array }>}
 */
async function runAgenticLoop({ provider, apiKey, model, systemPrompt, messages, tools, executeTool, maxTokens = 1500 }) {
  const toolCallsAccum = [];
  let finalText = '';
  let currentMessages = [...messages];

  const MAX_ROUNDS = 5;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let resp;
    if (provider === 'openai') {
      resp = await openaiChat({ apiKey, model, systemPrompt, messages: currentMessages, tools, maxTokens });
    } else {
      resp = await anthropicChat({ apiKey, model, systemPrompt, messages: currentMessages, tools, maxTokens });
    }

    if (!resp._needsToolExecution) {
      finalText += resp.finalText;
      break;
    }

    // Execute pending tools
    finalText += resp.finalText;
    const toolResults = [];

    for (const pending of resp.toolResults) {
      const name   = pending._name;
      const input  = pending._input;
      const result = executeTool(name, input);
      toolCallsAccum.push({ tool: name, input, result });

      if (provider === 'openai') {
        toolResults.push({ role: 'tool', tool_call_id: pending.tool_call_id, content: JSON.stringify(result) });
      } else {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: pending.tool_use_id || pending._id,
          content: JSON.stringify(result),
        });
      }
    }

    // Rebuild messages with tool results for next round
    if (provider === 'openai') {
      currentMessages = [...resp.currentMessages, ...toolResults];
    } else {
      // For Anthropic: append assistant turn (with tool_use blocks) + user turn (with tool_results)
      // We need to re-call the original API so we pass the full message chain back in
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: resp._assistantContent || toolResults.map(tr => ({ type: 'tool_result', ...tr })) },
        { role: 'user',      content: toolResults },
      ];
      // Since Anthropic's response included the tool_use blocks as the assistant content,
      // we need to reconstruct it:
      // Actually, the simplest approach is to break out of the loop and use the accumulated
      // tool_results to call back to a fresh Anthropic request.
      break;
    }
  }

  // For Anthropic: do a proper multi-turn loop using the raw SDK directly
  if (provider === 'anthropic' && toolCallsAccum.length > 0) {
    // We already have the tool results — do one more pass to get the final text
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp2 = await client.messages.create({
        model, max_tokens: maxTokens, system: systemPrompt, tools,
        messages: currentMessages,
      });

      for (const block of resp2.content) {
        if (block.type === 'text') finalText += block.text;
      }

      if (resp2.stop_reason !== 'tool_use') break;

      const toolUseBlocks = resp2.content.filter(b => b.type === 'tool_use');
      if (!toolUseBlocks.length) break;

      const tr = [];
      for (const tu of toolUseBlocks) {
        const result = executeTool(tu.name, tu.input);
        toolCallsAccum.push({ tool: tu.name, input: tu.input, result });
        tr.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
      }
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: resp2.content },
        { role: 'user',      content: tr },
      ];
    }
  }

  return { finalText: finalText.trim(), toolCallsAccum };
}

// ── Exported helpers ──────────────────────────────────────────────────────────

/**
 * Resolve the effective AI config for a tenant.
 * Priority: tenant's own settings → platform defaults → env var fallback
 */
function resolveAIConfig(tenantAiSettings, platformConfig) {
  // Tenant has their own key
  if (tenantAiSettings?.api_key) {
    return {
      provider: tenantAiSettings.provider || 'anthropic',
      model:    tenantAiSettings.model    || PROVIDER_MODELS.anthropic[0].id,
      apiKey:   tenantAiSettings.api_key,
    };
  }
  // Platform key allowed and available
  if (platformConfig?.api_key && platformConfig?.allow_tenant_keys !== 0) {
    return {
      provider: tenantAiSettings?.provider || platformConfig.provider || 'anthropic',
      model:    tenantAiSettings?.model    || platformConfig.model    || PROVIDER_MODELS.anthropic[0].id,
      apiKey:   platformConfig.api_key,
    };
  }
  // Env var fallback
  const envKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  if (envKey) {
    const envProvider = process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai';
    return {
      provider: tenantAiSettings?.provider || platformConfig?.provider || envProvider,
      model:    tenantAiSettings?.model    || platformConfig?.model    || PROVIDER_MODELS[envProvider][0].id,
      apiKey:   envKey,
    };
  }
  return null; // not configured
}

module.exports = { runAgenticLoop, resolveAIConfig, PROVIDER_MODELS };
