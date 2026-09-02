import type { ProviderId } from '../pricing.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number | undefined;
  topP?: number | undefined;
  stop?: string[] | undefined;
}

export interface ProviderResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  usageSource: 'provider' | 'estimated';
  finishReason: string;
  upstreamModel: string;
}

export type ErrorClass =
  | 'timeout'          // we gave up waiting
  | 'network'          // DNS/connection/socket failure
  | 'rate_limit'       // 429
  | 'upstream_5xx'     // 500/502/503/504
  | 'bad_request'      // 400/422 -- our or the caller's fault, deterministic
  | 'auth'             // 401/403 -- OUR credential is wrong
  | 'not_found'        // 404 -- model does not exist upstream
  | 'too_large'        // 413 -- request too large or TPM limit exceeded
  | 'content_policy'   // upstream refused on policy grounds
  | 'not_configured'   // adapter has no credential; skip it
  | 'unknown';

export class ProviderError extends Error {
  constructor(
    readonly errorClass: ErrorClass,
    message: string,
    readonly statusCode?: number,
    /** Seconds, parsed from a Retry-After header when the upstream sends one. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Retry the SAME provider? Only for conditions that are plausibly transient
 * within a couple of seconds.
 */
export function isRetryableSameProvider(c: ErrorClass): boolean {
  return c === 'timeout' || c === 'network' || c === 'rate_limit' || c === 'upstream_5xx';
}
export function isFailoverable(c: ErrorClass): boolean {
  return (
    c === 'timeout' ||
    c === 'network' ||
    c === 'rate_limit' ||
    c === 'upstream_5xx' ||
    c === 'not_configured' ||
    c === 'not_found' ||
    c === 'too_large'
  );
}

export interface Provider {
  readonly id: ProviderId;
  isConfigured(): boolean;
  chat(req: ProviderChatRequest, signal: AbortSignal): Promise<ProviderResult>;
}
