import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createApiKey, isValidAdminToken } from '../auth.js';
import { pool } from '../db/pool.js';
import { nanosToUsdString } from '../pricing.js';


interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  budget_nanos: bigint;
  spent_nanos: bigint;
  reserved_nanos: bigint;
  disabled: boolean;
  created_at: Date;
  expires_at: Date | null;
}


export function registerAdminRoutes(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/admin')) return;
    if (!isValidAdminToken(request.headers.authorization)) {
      return reply.status(401).send({
        error: { message: 'Admin token required.', type: 'admin_unauthorized' },
      });
    }
  });

  app.post('/admin/keys', async (request, reply) => {
    const body = (request.body ?? {}) as { name?: unknown; budget_usd?: unknown; expires_at?: unknown };

    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return badRequest(reply, 'Field "name" is required.');
    }
    let budgetNanos: bigint;
    try {
      budgetNanos = parseUsdToNanos(body.budget_usd);
    } catch (err) {
      return badRequest(reply, (err as Error).message);
    }

    let expiresAt: Date | null = null;
    if (body.expires_at !== undefined && body.expires_at !== null) {
      const d = new Date(String(body.expires_at));
      if (Number.isNaN(d.getTime())) return badRequest(reply, 'expires_at must be an ISO8601 date.');
      expiresAt = d;
    }

    const { plaintextKey, record } = await createApiKey(body.name.trim(), budgetNanos, expiresAt);

    return reply.status(201).send({
      api_key: plaintextKey,
      warning: 'Store this now. It is hashed server-side and cannot be retrieved again.',
      key: {
        id: record.id,
        name: record.name,
        key_prefix: record.keyPrefix,
        budget_usd: nanosToUsdString(record.budgetNanos),
        spent_usd: nanosToUsdString(record.spentNanos),
        expires_at: record.expiresAt,
      },
    });
  });

  app.get('/admin/keys', async (_request, reply) => {
    const { rows } = await pool.query<KeyRow>(`
      SELECT id, name, key_prefix, budget_nanos, spent_nanos, reserved_nanos,
             disabled, created_at, expires_at
        FROM api_keys
       ORDER BY created_at DESC
    `);
    return reply.send({
      keys: rows.map((r) => ({
        id: r.id,
        name: r.name,
        key_prefix: r.key_prefix,
        budget_usd: nanosToUsdString(r.budget_nanos),
        spent_usd: nanosToUsdString(r.spent_nanos),
        held_usd: nanosToUsdString(r.reserved_nanos),
        remaining_usd: nanosToUsdString(r.budget_nanos - r.spent_nanos - r.reserved_nanos),
        disabled: r.disabled,
        created_at: r.created_at,
        expires_at: r.expires_at,
      })),
    });
  });

  app.post('/admin/keys/:id/disable', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { rowCount } = await pool.query('UPDATE api_keys SET disabled = TRUE WHERE id = $1', [id]);
    if (rowCount === 0) return reply.status(404).send({ error: { message: 'Key not found.' } });
    return reply.send({ ok: true, id, disabled: true });
  });

  app.get('/admin/usage', async (request, reply) => {
    const q = request.query as { key?: string; key_id?: string; limit?: string };

    let keyId = q.key_id;
    if (!keyId && q.key) {
      const hash = createHash('sha256').update(q.key, 'utf8').digest('hex');
      const { rows } = await pool.query('SELECT id FROM api_keys WHERE key_hash = $1', [hash]);
      keyId = rows[0]?.id;
    }
    if (!keyId) {
      return badRequest(reply, 'Provide ?key=<plaintext key> or ?key_id=<uuid>.');
    }

    const { rows: keyRows } = await pool.query<KeyRow>(
      `SELECT id, name, key_prefix, budget_nanos, spent_nanos, reserved_nanos, disabled, created_at
         FROM api_keys WHERE id = $1`,
      [keyId],
    );
    const k = keyRows[0];
    if (!k) return reply.status(404).send({ error: { message: 'Key not found.' } });

    const { rows: aggRows } = await pool.query(
      `
      -- Every ::bigint cast here is load-bearing. Postgres SUM() over a BIGINT
      -- column returns NUMERIC, and node-postgres surfaces NUMERIC as a STRING.
      -- Without the cast, ledger_nanos arrives as '116250' and the integrity
      -- comparison against spent_nanos (a bigint) is false on every request.
      SELECT COALESCE(SUM(cost_nanos), 0)::bigint                           AS ledger_nanos,
             COUNT(*) FILTER (WHERE status = 'ok')                          AS ok_attempts,
             COUNT(*) FILTER (WHERE status = 'error')                       AS failed_attempts,
             COUNT(DISTINCT request_id)                                     AS requests,
             COALESCE(SUM(input_tokens), 0)::bigint                         AS input_tokens,
             COALESCE(SUM(output_tokens), 0)::bigint                        AS output_tokens
        FROM usage_events WHERE key_id = $1
      `,
      [keyId],
    );
    const agg = aggRows[0];

    const { rows: byModel } = await pool.query(
      `
      SELECT provider, model,
             COUNT(*)                                  AS attempts,
             COALESCE(SUM(input_tokens), 0)::bigint    AS input_tokens,
             COALESCE(SUM(output_tokens), 0)::bigint   AS output_tokens,
             COALESCE(SUM(cost_nanos), 0)::bigint      AS cost_nanos
        FROM usage_events WHERE key_id = $1
       GROUP BY provider, model ORDER BY cost_nanos DESC
      `,
      [keyId],
    );

    const limit = Math.min(Number.parseInt(q.limit ?? '20', 10) || 20, 200);
    const { rows: recent } = await pool.query(
      `
      SELECT request_id, attempt_index, provider, model, input_tokens, output_tokens,
             cost_nanos, usage_source, status, error_class, latency_ms, created_at
        FROM usage_events WHERE key_id = $1
       ORDER BY created_at DESC LIMIT $2
      `,
      [keyId, limit],
    );

    const ledgerNanos: bigint = agg.ledger_nanos;
    const reconciled = ledgerNanos === k.spent_nanos;

    return reply.send({
      key: {
        id: k.id,
        name: k.name,
        key_prefix: k.key_prefix,
        disabled: k.disabled,
        created_at: k.created_at,
      },
      budget: {
        budget_usd: nanosToUsdString(k.budget_nanos),
        spent_usd: nanosToUsdString(k.spent_nanos),
        held_usd: nanosToUsdString(k.reserved_nanos),
        remaining_usd: nanosToUsdString(k.budget_nanos - k.spent_nanos - k.reserved_nanos),
        percent_used:
          k.budget_nanos > 0n
            ? Number((k.spent_nanos * 10000n) / k.budget_nanos) / 100
            : null,
      },
      totals: {
        requests: Number(agg.requests),
        ok_attempts: Number(agg.ok_attempts),
        failed_attempts: Number(agg.failed_attempts),
        input_tokens: Number(agg.input_tokens),
        output_tokens: Number(agg.output_tokens),
      },
      by_model: byModel.map((r) => ({
        provider: r.provider,
        model: r.model,
        attempts: Number(r.attempts),
        input_tokens: Number(r.input_tokens),
        output_tokens: Number(r.output_tokens),
        cost_usd: nanosToUsdString(r.cost_nanos),
      })),
      recent_events: recent.map((r) => ({
        request_id: r.request_id,
        attempt: r.attempt_index,
        provider: r.provider,
        model: r.model,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        cost_usd: nanosToUsdString(r.cost_nanos),
        usage_source: r.usage_source,
        status: r.status,
        error_class: r.error_class,
        latency_ms: r.latency_ms,
        at: r.created_at,
      })),
      integrity: {
        ledger_sum_usd: nanosToUsdString(ledgerNanos),
        key_spent_usd: nanosToUsdString(k.spent_nanos),
        reconciled,
      },
    });
  });
}

export function parseUsdToNanos(input: unknown): bigint {
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw new Error('budget_usd is required (string or number, e.g. "0.05").');
  }
  const s = String(input).trim();
  if (!/^\d+(\.\d{1,9})?$/.test(s)) {
    throw new Error(`budget_usd must be a non-negative decimal with <= 9 dp, got "${s}".`);
  }
  const [whole = '0', frac = ''] = s.split('.');
  return BigInt(whole) * 1_000_000_000n + BigInt(frac.padEnd(9, '0'));
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({ error: { message, type: 'invalid_request' } });
}
