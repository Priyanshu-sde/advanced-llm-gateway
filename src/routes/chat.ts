import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate } from '../auth.js';
import { releaseReservation, reserve, settle } from '../budget.js';
import { attemptsToUsageEvents, executeChain } from '../chain.js';
import { config } from '../config.js';
import { costNanos, nanosToUsdString, resolveRoute, supportedModels } from '../pricing.js';
import { estimateInputTokens } from '../tokens.js';
import type { ChatMessage, ErrorClass } from '../providers/types.js';

const MAX_ALLOWED_MAX_TOKENS = 4096;

const ALLOWED_FIELDS = new Set([
  'model',
  'messages',
  'max_tokens',
  'temperature',
  'top_p',
  'stop',
  'stream',
]);

interface ChatBody {
  model?: unknown;
  messages?: unknown;
  max_tokens?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  stop?: unknown;
  stream?: unknown;
}

export function registerChatRoutes(app: FastifyInstance): void {
  app.post('/v1/chat/completions', handleChatCompletion);
}

async function handleChatCompletion(request: FastifyRequest, reply: FastifyReply) {
  const requestId = randomUUID();
  reply.header('x-gw-request-id', requestId);

  const auth = await authenticate(request.headers.authorization);
  if (!auth.ok) {
    return sendError(reply, 401, 'invalid_api_key', authMessage(auth.reason), requestId);
  }

  const body = (request.body ?? {}) as ChatBody;
  const validation = validate(body);
  if ('error' in validation) {
    return sendError(reply, 400, validation.code, validation.error, requestId);
  }

  const { model, messages, maxTokens, temperature, topP, stop } = validation;
  const chain = resolveRoute(model);

  if (!chain?.length) {
    const supported = supportedModels().join(', ');
    return sendError(reply, 400, 'model_not_found', `Unknown model '${model}'. Supported: ${supported}`, requestId);
  }

  const estInputTokens = estimateInputTokens(messages);
  const worstCaseNanos = chain.reduce((max, target) => {
    const c = costNanos(target, estInputTokens, maxTokens);
    return c > max ? c : max;
  }, 0n);

  const reservation = await reserve(auth.key.id, worstCaseNanos, requestId);
  if (!reservation.ok) {
    const { budgetNanos, spentNanos, reservedNanos } = reservation.snapshot;
    const msg = `Budget exceeded for key '${auth.key.name}'. Budget $${nanosToUsdString(budgetNanos)}, spent $${nanosToUsdString(spentNanos)}, held $${nanosToUsdString(reservedNanos)}, this request needs up to $${nanosToUsdString(worstCaseNanos)}.`;
    return sendError(reply, 402, 'budget_exceeded', msg, requestId);
  }

  const injectFailure = parseInjectHeader(request);
  const outcome = await executeChain(
    chain,
    { messages, maxTokens, temperature, topP, stop },
    { injectFailure },
  );

  const events = attemptsToUsageEvents(requestId, outcome.attempts);
  if (events.length === 0) {
    await releaseReservation(reservation.handle.reservationId);
  }

  let snapshot = null;
  try {
    if (events.length > 0) {
      snapshot = await settle(auth.key.id, reservation.handle.reservationId, events);
    }
  } catch (err) {
    request.log.error(
      { requestId, keyId: auth.key.id, err: (err as Error).message },
      'settle failed; leaving reservation to expire',
    );
    return sendError(reply, 500, 'accounting_error', 'Upstream call completed but usage could not be recorded; request failed closed.', requestId);
  }

  if (!outcome.result || !outcome.servedBy) {
    const err = outcome.finalError;
    reply.header('x-gw-attempts', String(outcome.attempts.length));
    return sendError(
      reply,
      statusForErrorClass(err?.errorClass ?? 'unknown'),
      err?.errorClass ?? 'upstream_error',
      `All ${outcome.attempts.length} provider attempt(s) failed. Last error: ${err?.message ?? 'unknown'}`,
      requestId,
    );
  }

  const { servedBy: served, result } = outcome;
  const requestCostNanos = events.reduce((a, e) => a + e.costNanos, 0n);

  const responseHeaders: Record<string, string> = {
    'x-gw-provider': served.provider,
    'x-gw-upstream-model': result.upstreamModel,
    'x-gw-attempts': String(outcome.attempts.length),
    'x-gw-cost-usd': nanosToUsdString(requestCostNanos),
    'x-gw-usage-source': result.usageSource,
  };

  if (snapshot) {
    responseHeaders['x-gw-key-spent-usd'] = nanosToUsdString(snapshot.spentNanos);
    responseHeaders['x-gw-key-budget-usd'] = nanosToUsdString(snapshot.budgetNanos);
  }

  reply.headers(responseHeaders);

  return reply.status(200).send({
    id: `chatcmpl-${requestId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: result.content },
        finish_reason: result.finishReason,
      },
    ],
    usage: {
      prompt_tokens: result.inputTokens,
      completion_tokens: result.outputTokens,
      total_tokens: result.inputTokens + result.outputTokens,
    },
    x_gateway: {
      request_id: requestId,
      served_by: `${served.provider}:${result.upstreamModel}`,
      attempts: outcome.attempts.map((a) => ({
        provider: a.target.provider,
        model: a.target.model,
        status: a.status,
        error_class: a.errorClass ?? null,
        latency_ms: a.latencyMs,
      })),
      usage_source: result.usageSource,
      cost_usd: nanosToUsdString(requestCostNanos),
      key_spent_usd: snapshot ? nanosToUsdString(snapshot.spentNanos) : null,
      key_budget_usd: snapshot ? nanosToUsdString(snapshot.budgetNanos) : null,
    },
  });
}

type Validated = {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
};

function validate(body: ChatBody): Validated | { error: string; code: string } {
  const unknown = Object.keys(body).filter((k) => !ALLOWED_FIELDS.has(k));
  if (unknown.length > 0) {
    return {
      code: 'unsupported_parameter',
      error:
        `Unsupported parameter(s): ${unknown.join(', ')}. ` +
        `This gateway accepts only ${[...ALLOWED_FIELDS].join(', ')} because budget ` +
        `enforcement requires bounding a request's cost before forwarding it.`,
    };
  }

  if (body.stream === true) {
    return {
      code: 'streaming_unsupported',
      error:
        'stream:true is not supported. This gateway is non-streaming by design: ' +
        'usage arrives in the final SSE chunk and is lost if a client disconnects, ' +
        'and a response cannot be failed over once bytes are committed. See DECISIONS.md.',
    };
  }

  if (typeof body.model !== 'string' || body.model.trim() === '') {
    return { code: 'invalid_request', error: 'Field "model" is required and must be a string.' };
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return {
      code: 'invalid_request',
      error: 'Field "messages" is required and must be a non-empty array.',
    };
  }

  const messages: ChatMessage[] = [];
  for (const [i, raw] of body.messages.entries()) {
    const m = raw as { role?: unknown; content?: unknown };
    if (m.role !== 'system' && m.role !== 'user' && m.role !== 'assistant') {
      return {
        code: 'invalid_request',
        error: `messages[${i}].role must be one of: system, user, assistant.`,
      };
    }
    if (typeof m.content !== 'string') {
      return { code: 'invalid_request', error: `messages[${i}].content must be a string.` };
    }
    messages.push({ role: m.role, content: m.content });
  }

  let maxTokens = config.defaultMaxTokens;
  if (body.max_tokens !== undefined) {
    if (typeof body.max_tokens !== 'number' || !Number.isInteger(body.max_tokens) || body.max_tokens < 1) {
      return { code: 'invalid_request', error: 'max_tokens must be a positive integer.' };
    }
    if (body.max_tokens > MAX_ALLOWED_MAX_TOKENS) {
      return {
        code: 'invalid_request',
        error: `max_tokens may not exceed ${MAX_ALLOWED_MAX_TOKENS} on this gateway.`,
      };
    }
    maxTokens = body.max_tokens;
  }

  const out: Validated = { model: body.model.trim(), messages, maxTokens };

  if (body.temperature !== undefined) {
    if (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2) {
      return { code: 'invalid_request', error: 'temperature must be a number in [0, 2].' };
    }
    out.temperature = body.temperature;
  }
  if (body.top_p !== undefined) {
    if (typeof body.top_p !== 'number' || body.top_p <= 0 || body.top_p > 1) {
      return { code: 'invalid_request', error: 'top_p must be a number in (0, 1].' };
    }
    out.topP = body.top_p;
  }
  if (body.stop !== undefined) {
    const arr = Array.isArray(body.stop) ? body.stop : [body.stop];
    if (!arr.every((s) => typeof s === 'string')) {
      return { code: 'invalid_request', error: 'stop must be a string or array of strings.' };
    }
    out.stop = arr as string[];
  }

  return out;
}

/** `x-gw-inject-failure: groq` or `groq:rate_limit`. Test hook, env-gated. */
function parseInjectHeader(
  request: FastifyRequest,
): { provider: string; errorClass: ErrorClass } | null {
  if (!config.allowFailureInjection) return null;
  const raw = request.headers['x-gw-inject-failure'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const [provider, cls] = value.split(':');
  if (!provider) return null;
  return { provider: provider.trim(), errorClass: (cls?.trim() as ErrorClass) || 'upstream_5xx' };
}

function statusForErrorClass(c: string): number {
  const statusMap: Record<string, number> = {
    bad_request: 400,
    content_policy: 400,
    not_found: 404,
    rate_limit: 429,
    timeout: 504,
  };
  return statusMap[c] ?? 502;
}

function authMessage(reason: string): string {
  const messages: Record<string, string> = {
    missing: 'Missing Authorization header. Use: Authorization: Bearer gw_live_...',
    malformed: 'Malformed Authorization header. Expected: Bearer gw_live_...',
    disabled: 'This API key has been disabled.',
    expired: 'This API key has expired.',
  };
  return messages[reason] ?? 'Invalid API key.';
}

function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  reply.header('x-gw-request-id', requestId);
  return reply.status(status).send({
    error: { message, type: code, code, param: null },
    request_id: requestId,
  });
}
