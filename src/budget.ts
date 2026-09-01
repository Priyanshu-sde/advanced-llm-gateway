import type { PoolClient } from 'pg';
import { pool, withTransaction } from './db/pool.js';
import { config } from './config.js';

export interface ReservationHandle {
  reservationId: string;
  amountNanos: bigint;
}

export interface BudgetSnapshot {
  budgetNanos: bigint;
  spentNanos: bigint;
  reservedNanos: bigint;
}


async function sweepExpired(client: PoolClient, keyId: string): Promise<void> {
  await client.query(
    `
    WITH expired AS (
      UPDATE reservations
         SET released_at = now()
       WHERE key_id = $1
         AND released_at IS NULL
         AND expires_at <= now()
       RETURNING amount_nanos
    )
    UPDATE api_keys
       SET reserved_nanos = GREATEST(
             0,
             reserved_nanos - COALESCE((SELECT SUM(amount_nanos) FROM expired), 0)
           )
     WHERE id = $1
    `,
    [keyId],
  );
}

export type ReserveResult =
  | { ok: true; handle: ReservationHandle }
  | { ok: false; snapshot: BudgetSnapshot };


export async function reserve(
  keyId: string,
  amountNanos: bigint,
  requestId: string,
): Promise<ReserveResult> {
  return withTransaction(async (client) => {
    await sweepExpired(client, keyId);


    const { rows } = await client.query<{ id: string }>(
      `
      WITH gate AS (
        UPDATE api_keys
           SET reserved_nanos = reserved_nanos + $2::bigint
         WHERE id = $1
           AND disabled = FALSE
           AND (expires_at IS NULL OR expires_at > now())
           AND spent_nanos < budget_nanos
           AND spent_nanos + reserved_nanos + $2::bigint <= budget_nanos
        RETURNING id
      )
      INSERT INTO reservations (key_id, request_id, amount_nanos, expires_at)
      SELECT gate.id, $3, $2::bigint, now() + make_interval(secs => $4::int)
        FROM gate
      RETURNING id
      `,
      [keyId, amountNanos.toString(), requestId, config.reservationTtlSeconds],
    );

    const row = rows[0];
    if (!row) {
      const snapshot = await readSnapshot(client, keyId);
      return { ok: false, snapshot };
    }
    return { ok: true, handle: { reservationId: row.id, amountNanos } };
  });
}


export async function releaseReservation(reservationId: string): Promise<void> {
  await pool.query(
    `
    WITH r AS (
      UPDATE reservations
         SET released_at = now()
       WHERE id = $1 AND released_at IS NULL
       RETURNING key_id, amount_nanos
    )
    UPDATE api_keys
       SET reserved_nanos = GREATEST(
             0, reserved_nanos - COALESCE((SELECT amount_nanos FROM r), 0)
           )
     WHERE id = (SELECT key_id FROM r)
    `,
    [reservationId],
  );
}

export interface UsageEventInput {
  requestId: string;
  attemptIndex: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costNanos: bigint;
  usageSource: 'provider' | 'estimated' | 'none';
  status: 'ok' | 'error';
  errorClass?: string | null;
  errorMessage?: string | null;
  latencyMs: number;
}

export async function settle(
  keyId: string,
  reservationId: string,
  events: UsageEventInput[],
): Promise<BudgetSnapshot> {
  const totalCost = events.reduce((acc, e) => acc + e.costNanos, 0n);

  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      budget_nanos: bigint;
      spent_nanos: bigint;
      reserved_nanos: bigint;
    }>(
      `
      WITH r AS (
        UPDATE reservations
           SET released_at = now()
         WHERE id = $1 AND released_at IS NULL
         RETURNING amount_nanos
      )
      UPDATE api_keys
         SET spent_nanos    = spent_nanos + $3::bigint,
             -- COALESCE handles the already-swept case: if the hold expired and
             -- was reclaimed while the provider call was in flight, r is empty
             -- and we subtract 0 rather than double-decrementing.
             reserved_nanos = GREATEST(
               0, reserved_nanos - COALESCE((SELECT amount_nanos FROM r), 0)
             )
       WHERE id = $2
      RETURNING budget_nanos, spent_nanos, reserved_nanos
      `,
      [reservationId, keyId, totalCost.toString()],
    );

    for (const e of events) {
      await client.query(
        `
        INSERT INTO usage_events
          (key_id, request_id, attempt_index, provider, model,
           input_tokens, output_tokens, cost_nanos, usage_source,
           status, error_class, error_message, latency_ms)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::bigint,$9,$10,$11,$12,$13)
        `,
        [
          keyId,
          e.requestId,
          e.attemptIndex,
          e.provider,
          e.model,
          e.inputTokens,
          e.outputTokens,
          e.costNanos.toString(),
          e.usageSource,
          e.status,
          e.errorClass ?? null,
          e.errorMessage ?? null,
          e.latencyMs,
        ],
      );
    }

    const row = rows[0];
    if (!row) throw new Error(`settle: api key ${keyId} vanished mid-request`);
    return {
      budgetNanos: row.budget_nanos,
      spentNanos: row.spent_nanos,
      reservedNanos: row.reserved_nanos,
    };
  });
}

async function readSnapshot(client: PoolClient, keyId: string): Promise<BudgetSnapshot> {
  const { rows } = await client.query<{
    budget_nanos: bigint;
    spent_nanos: bigint;
    reserved_nanos: bigint;
  }>('SELECT budget_nanos, spent_nanos, reserved_nanos FROM api_keys WHERE id = $1', [keyId]);
  const row = rows[0];
  if (!row) throw new Error(`readSnapshot: api key ${keyId} not found`);
  return {
    budgetNanos: row.budget_nanos,
    spentNanos: row.spent_nanos,
    reservedNanos: row.reserved_nanos,
  };
}
