function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v.trim();
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`env ${name} must be a positive integer, got: ${raw}`);
  }
  return n;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export const config = {
  port: intEnv('PORT', 8080),
  host: optional('HOST', '0.0.0.0'),
  databaseUrl: required('DATABASE_URL'),
  adminToken: required('ADMIN_TOKEN'),
  groqApiKey: process.env.GROQ_API_KEY?.trim() || null,
  groqBaseUrl: optional('GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),
  providerChain: optional('PROVIDER_CHAIN', 'groq,mock')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  providerTimeoutMs: intEnv('PROVIDER_TIMEOUT_MS', 30_000),
  reservationTtlSeconds: intEnv('RESERVATION_TTL_SECONDS', 180),
  defaultMaxTokens: intEnv('DEFAULT_MAX_TOKENS', 512),
  allowFailureInjection: boolEnv('ALLOW_FAILURE_INJECTION', false),

  logLevel: optional('LOG_LEVEL', 'info'),
} as const;

export type Config = typeof config;
