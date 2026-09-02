import { config } from './config.js';
import { costNanos, type ProviderTarget } from './pricing.js';
import { GroqProvider } from './providers/groq.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import {
  isFailoverable,
  isRetryableSameProvider,
  ProviderError,
  type ErrorClass,
  type Provider,
  type ProviderChatRequest,
  type ProviderResult,
} from './providers/types.js';
import type { UsageEventInput } from './budget.js';

const PROVIDERS: Record<string, Provider> = {
  groq: new GroqProvider(),
  openrouter: new OpenRouterProvider(),
};

const MAX_ATTEMPTS_PER_PROVIDER = 8;
const BACKOFF_BASE_MS = 250;

const MAX_RETRY_AFTER_MS = 2_000;

export interface ChainAttempt {
  target: ProviderTarget;
  status: 'ok' | 'error';
  latencyMs: number;
  errorClass?: ErrorClass;
  errorMessage?: string;
  result?: ProviderResult;
}

export interface ChainOutcome {
  result?: ProviderResult | undefined;
  servedBy?: ProviderTarget | undefined;
  attempts: ChainAttempt[];
  finalError?: ProviderError | undefined;
}

export interface ChainOptions {
  injectFailure?: { provider: string; errorClass: ErrorClass } | null;
}

export async function executeChain(
  chain: ProviderTarget[],
  req: Omit<ProviderChatRequest, 'model'>,
  opts: ChainOptions = {},
): Promise<ChainOutcome> {
  const attempts: ChainAttempt[] = [];
  let lastError: ProviderError | undefined;

  for (const target of chain) {
    const provider = PROVIDERS[target.provider];
    if (!provider) {
      attempts.push({
        target,
        status: 'error',
        latencyMs: 0,
        errorClass: 'unknown',
        errorMessage: `no adapter registered for provider '${target.provider}'`,
      });
      continue;
    }

    if (!provider.isConfigured()) {

      attempts.push({
        target,
        status: 'error',
        latencyMs: 0,
        errorClass: 'not_configured',
        errorMessage: `${target.provider} has no credential configured`,
      });
      lastError = new ProviderError('not_configured', `${target.provider} not configured`);
      continue;
    }

    const providerReq: ProviderChatRequest = { ...req, model: target.model };
    let giveUpOnChain = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_PROVIDER; attempt++) {
      const startedAt = Date.now();
      try {
        const result = await callWithTimeout(provider, providerReq, target, opts);
        attempts.push({ target, status: 'ok', latencyMs: Date.now() - startedAt, result });
        return { result, servedBy: target, attempts };
      } catch (err) {
        const pErr =
          err instanceof ProviderError
            ? err
            : new ProviderError('unknown', (err as Error).message ?? 'unknown provider error');

        attempts.push({
          target,
          status: 'error',
          latencyMs: Date.now() - startedAt,
          errorClass: pErr.errorClass,
          errorMessage: pErr.message,
        });
        lastError = pErr;

        const canRetryHere =
          isRetryableSameProvider(pErr.errorClass) && attempt < MAX_ATTEMPTS_PER_PROVIDER - 1;

        if (canRetryHere) {
          await sleep(backoffMs(attempt, pErr.retryAfterSeconds));
          continue;
        }

        if (!isFailoverable(pErr.errorClass)) {
          // Deterministic failure -- a different provider will fail identically.
          // Stop the whole chain and surface the real reason immediately.
          giveUpOnChain = true;
        }
        break;
      }
    }

    if (giveUpOnChain) break;
  }

  return { attempts, finalError: lastError };
}

async function callWithTimeout(
  provider: Provider,
  req: ProviderChatRequest,
  target: ProviderTarget,
  opts: ChainOptions,
): Promise<ProviderResult> {
  if (
    config.allowFailureInjection &&
    opts.injectFailure &&
    opts.injectFailure.provider === target.provider
  ) {
    throw new ProviderError(
      opts.injectFailure.errorClass,
      `injected ${opts.injectFailure.errorClass} failure for ${target.provider} (test hook)`,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.providerTimeoutMs);
  try {
    return await provider.chat(req, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function backoffMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined) {
    return Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
  }
  const base = BACKOFF_BASE_MS * 2 ** attempt;
  // Full jitter. Without it, a fleet of gateways that all saw the same upstream
  // blip retries in lockstep and re-DDoSes the provider on recovery.
  return Math.floor(Math.random() * base);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Turn chain attempts into ledger rows -- one row per attempt, including the
 * failures.
 *
 * Failed attempts are recorded at cost 0, with a caveat worth stating plainly:
 * if a provider generated tokens and then the connection timed out, the
 * provider still billed us and we have no usage object to read. That spend is
 * invisible to this ledger. Closing that gap requires reconciling against the
 * provider's own billing API, which is out of scope here. The error rows at
 * least make the invisible spend inferable rather than undetectable.
 */
export function attemptsToUsageEvents(
  requestId: string,
  attempts: ChainAttempt[],
): UsageEventInput[] {
  return attempts.map((a, i) => {
    if (a.status === 'ok' && a.result) {
      return {
        requestId,
        attemptIndex: i,
        provider: a.target.provider,
        model: a.target.model,
        inputTokens: a.result.inputTokens,
        outputTokens: a.result.outputTokens,
        costNanos: costNanos(a.target, a.result.inputTokens, a.result.outputTokens),
        usageSource: a.result.usageSource,
        status: 'ok' as const,
        latencyMs: a.latencyMs,
      };
    }
    return {
      requestId,
      attemptIndex: i,
      provider: a.target.provider,
      model: a.target.model,
      inputTokens: 0,
      outputTokens: 0,
      costNanos: 0n,
      usageSource: 'none' as const,
      status: 'error' as const,
      errorClass: a.errorClass ?? 'unknown',
      errorMessage: a.errorMessage?.slice(0, 500) ?? null,
      latencyMs: a.latencyMs,
    };
  });
}
