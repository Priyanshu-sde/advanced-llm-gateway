import { config } from '../config.js';
import {
  ProviderError,
  type ErrorClass,
  type Provider,
  type ProviderChatRequest,
  type ProviderResult,
} from './types.js';


export class GroqProvider implements Provider {
  readonly id = 'groq' as const;

  isConfigured(): boolean {
    return config.groqApiKey !== null;
  }

  async chat(req: ProviderChatRequest, signal: AbortSignal): Promise<ProviderResult> {
    if (!config.groqApiKey) {
      throw new ProviderError('not_configured', 'GROQ_API_KEY is not set');
    }

    let res: Response;
    try {
      res = await fetch(`${config.groqBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.groqApiKey}`,
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          max_tokens: req.maxTokens,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.topP !== undefined ? { top_p: req.topP } : {}),
          ...(req.stop ? { stop: req.stop } : {}),
          stream: false,
        }),
        signal,
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError' || signal.aborted) {
        throw new ProviderError('timeout', `groq timed out after ${config.providerTimeoutMs}ms`);
      }
      throw new ProviderError('network', `groq connection failed: ${e.message}`);
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new ProviderError(
        classifyStatus(res.status, bodyText),
        `groq returned ${res.status}: ${truncate(bodyText, 300)}`,
        res.status,
        parseRetryAfter(res.headers.get('retry-after')),
      );
    }

    const body = (await res.json()) as GroqChatResponse;

    const choice = body.choices?.[0];
    if (!choice) {
      throw new ProviderError('upstream_5xx', 'groq returned no choices');
    }

    const usage = body.usage;
    if (
      !usage ||
      typeof usage.prompt_tokens !== 'number' ||
      typeof usage.completion_tokens !== 'number'
    ) {
      throw new ProviderError(
        'upstream_5xx',
        'groq response missing usage.prompt_tokens/completion_tokens; refusing to bill 0',
      );
    }

    return {
      content: choice.message?.content ?? '',
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      usageSource: 'provider',
      finishReason: choice.finish_reason ?? 'stop',
      upstreamModel: body.model ?? req.model,
    };
  }
}

function classifyStatus(status: number, body: string): ErrorClass {
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 413) return 'too_large';
  if (status >= 500) return 'upstream_5xx';
  if (status === 400 || status === 422) {
    if (/tokens? per minute|tpm|too large|limit/i.test(body)) return 'too_large';
    return /content[_ ]policy|moderation|flagged/i.test(body) ? 'content_policy' : 'bad_request';
  }
  return 'unknown';
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const n = Number.parseFloat(header);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}...`;
}

interface GroqChatResponse {
  model?: string;
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}
