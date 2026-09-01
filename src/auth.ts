import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { pool } from './db/pool.js';
import { config } from './config.js';

const KEY_PREFIX = 'gw_live_';

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  budgetNanos: bigint;
  spentNanos: bigint;
  reservedNanos: bigint;
  disabled: boolean;
  expiresAt: Date | null;
}

function hashKey(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export async function createApiKey(
  name: string,
  budgetNanos: bigint,
  expiresAt: Date | null = null,
): Promise<{ plaintextKey: string; record: ApiKeyRecord }> {
  const raw = KEY_PREFIX + randomBytes(32).toString('base64url');
  const hash = hashKey(raw);
  const prefix = raw.slice(0, KEY_PREFIX.length + 8);

  const { rows } = await pool.query(
    `
    INSERT INTO api_keys (name, key_hash, key_prefix, budget_nanos, expires_at)
    VALUES ($1, $2, $3, $4::bigint, $5)
    RETURNING id, name, key_prefix, budget_nanos, spent_nanos, reserved_nanos, disabled, expires_at
    `,
    [name, hash, prefix, budgetNanos.toString(), expiresAt],
  );

  return { plaintextKey: raw, record: toRecord(rows[0]) };
}

export type AuthFailure = 'missing' | 'malformed' | 'unknown_key' | 'disabled' | 'expired';

export type AuthResult =
  | { ok: true; key: ApiKeyRecord }
  | { ok: false; reason: AuthFailure };


export async function authenticate(authorizationHeader: string | undefined): Promise<AuthResult> {
  if (!authorizationHeader) return { ok: false, reason: 'missing' };

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  const raw = match?.[1]?.trim();
  if (!raw) return { ok: false, reason: 'malformed' };
  if (!raw.startsWith(KEY_PREFIX)) return { ok: false, reason: 'malformed' };

  const { rows } = await pool.query(
    `
    SELECT id, name, key_prefix, budget_nanos, spent_nanos, reserved_nanos, disabled, expires_at
      FROM api_keys
     WHERE key_hash = $1
    `,
    [hashKey(raw)],
  );

  const row = rows[0];
  if (!row) return { ok: false, reason: 'unknown_key' };

  const record = toRecord(row);
  if (record.disabled) return { ok: false, reason: 'disabled' };
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, key: record };
}


export function isValidAdminToken(header: string | undefined): boolean {
  if (!header) return false;
  const provided = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim() ?? header.trim();
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(config.adminToken, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function toRecord(row: any): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    budgetNanos: row.budget_nanos,
    spentNanos: row.spent_nanos,
    reservedNanos: row.reserved_nanos,
    disabled: row.disabled,
    expiresAt: row.expires_at,
  };
}
