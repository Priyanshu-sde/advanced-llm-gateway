import { estimateInputTokens } from './tokens.js';
import type { ChatMessage } from './providers/types.js';

export type ProviderId = 'groq' | 'openrouter';

export interface ProviderTarget {
  provider: ProviderId;
  model: string;
}

interface Price {
  usdPer1MInput: number;
  usdPer1MOutput: number;
}

const PRICES: Record<string, Price> = {
  'groq:openai/gpt-oss-20b': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'openrouter:openai/gpt-oss-20b': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'groq:openai/gpt-oss-120b': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'openrouter:openai/gpt-oss-120b': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'openrouter:inclusionai/ling-3.0-flash-fin:free': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'openrouter:dots-studio/dots-3-note-preview:free': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'openrouter:liquid/lfm-2.5-2.6b:free': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'openrouter:nvidia/nemotron-3.5-lightning:free': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'openrouter:cohere/north-mini-code:free': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'openrouter:nvidia/nemotron-3.5-content-safety:free': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'openrouter:google/lyria-3-pro-preview': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'openrouter:google/lyria-3-clip-preview': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'openrouter:minimax/minimax-m2.7:free': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'openrouter:nvidia/nemotron-3-super-120b-a12b:free': { usdPer1MInput: 10, usdPer1MOutput: 10 },
  'openrouter:openrouter/free': { usdPer1MInput: 10, usdPer1MOutput: 10 }
};


function nanosPerToken(usdPer1M: number): bigint {
  const exact = usdPer1M * 1000;
  const rounded = Math.round(exact);
  if (Math.abs(exact - rounded) > 1e-6) {
    throw new Error(
      `price ${usdPer1M} USD/1M is finer than nano-USD granularity; widen the money unit`,
    );
  }
  return BigInt(rounded);
}

export function priceKey(t: ProviderTarget): string {
  return `${t.provider}:${t.model}`;
}

export function costNanos(
  target: ProviderTarget,
  inputTokens: number,
  outputTokens: number,
): bigint {
  const price = PRICES[priceKey(target)];
  if (!price) {

    throw new Error(`no price entry for ${priceKey(target)}`);
  }
  return (
    BigInt(Math.max(0, Math.trunc(inputTokens))) * nanosPerToken(price.usdPer1MInput) +
    BigInt(Math.max(0, Math.trunc(outputTokens))) * nanosPerToken(price.usdPer1MOutput)
  );
}

export function isPriced(target: ProviderTarget): boolean {
  return PRICES[priceKey(target)] !== undefined;
}

export const MODEL_ROUTES: Record<string, ProviderTarget[]> = {
  'auto': [],
  'gpt-oss-20b': [
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'openrouter', model: 'openai/gpt-oss-20b' }
  ],
  'gpt-oss-120b': [
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'openrouter', model: 'openai/gpt-oss-120b' },
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'openrouter', model: 'openai/gpt-oss-20b' }
  ],
  'ling-3.0-flash-fin': [{ provider: 'openrouter', model: 'inclusionai/ling-3.0-flash-fin:free' }],
  'dots-3-note-preview': [{ provider: 'openrouter', model: 'dots-studio/dots-3-note-preview:free' }],
  'lfm-2.5-2.6b': [{ provider: 'openrouter', model: 'liquid/lfm-2.5-2.6b:free' }],
  'nemotron-3.5-lightning': [{ provider: 'openrouter', model: 'nvidia/nemotron-3.5-lightning:free' }],
  'north-mini-code': [{ provider: 'openrouter', model: 'cohere/north-mini-code:free' }],
  'nemotron-3.5-content-safety': [{ provider: 'openrouter', model: 'nvidia/nemotron-3.5-content-safety:free' }],
  'nemotron-3-nano-omni-30b-a3b-reasoning': [{ provider: 'openrouter', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free' }],
  'lyria-3-pro-preview': [{ provider: 'openrouter', model: 'google/lyria-3-pro-preview' }],
  'lyria-3-clip-preview': [{ provider: 'openrouter', model: 'google/lyria-3-clip-preview' }],
  'minimax-m2.7': [{ provider: 'openrouter', model: 'minimax/minimax-m2.7:free' }],
  'nemotron-3-super-120b-a12b': [{ provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' }],
  'free': [{ provider: 'openrouter', model: 'openrouter/free' }]
};

export function resolveRoute(model: string, messages?: ChatMessage[]): ProviderTarget[] | null {
  if (model === 'auto') {
    if (messages && estimateInputTokens(messages) > 1000) {
      return MODEL_ROUTES['gpt-oss-120b'] ?? null;
    }
    return MODEL_ROUTES['gpt-oss-20b'] ?? null;
  }
  return MODEL_ROUTES[model] ?? null;
}

export function supportedModels(): string[] {
  return Object.keys(MODEL_ROUTES);
}

export function getModelPricingInfo(): Record<string, { inputUsd: number, outputUsd: number }> {
  const info: Record<string, { inputUsd: number, outputUsd: number }> = {};
  for (const [model, chain] of Object.entries(MODEL_ROUTES)) {
    if (chain.length > 0) {
      const primary = chain[0];
      if (primary) {
        const price = PRICES[priceKey(primary)];
        if (price) {
          info[model] = { inputUsd: price.usdPer1MInput, outputUsd: price.usdPer1MOutput };
        }
      }
    }
  }
  return info;
}

export function nanosToUsdString(nanos: bigint): string {
  const neg = nanos < 0n;
  const abs = neg ? -nanos : nanos;
  const whole = abs / 1_000_000_000n;
  let frac = (abs % 1_000_000_000n).toString().padStart(9, '0');
  frac = frac.replace(/0+$/, '');
  while (frac.length < 2) frac += '0';
  return `${neg ? '-' : ''}${whole}.${frac}`;
}
