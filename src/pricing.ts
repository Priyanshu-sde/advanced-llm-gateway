
export type ProviderId = 'groq' | 'mock';

export interface ProviderTarget {
  provider: ProviderId;
  model: string;
}

interface Price {
  usdPer1MInput: number;
  usdPer1MOutput: number;
}

const PRICES: Record<string, Price> = {
  'groq:openai/gpt-oss-20b': { usdPer1MInput: 0.075, usdPer1MOutput: 0.3 },
  'groq:openai/gpt-oss-120b': { usdPer1MInput: 0.15, usdPer1MOutput: 0.6 },
  'mock:mock-echo': { usdPer1MInput: 0, usdPer1MOutput: 0 }
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
  'gpt-oss-20b': [
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'mock', model: 'mock-echo' },
  ],
  'gpt-oss-120b': [
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'mock', model: 'mock-echo' },
  ],

  'mock-echo': [{ provider: 'mock', model: 'mock-echo' }],
};

export function resolveRoute(model: string): ProviderTarget[] | null {
  return MODEL_ROUTES[model] ?? null;
}

export function supportedModels(): string[] {
  return Object.keys(MODEL_ROUTES);
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
