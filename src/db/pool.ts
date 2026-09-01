import pg from 'pg';
import { config } from '../config.js';


pg.types.setTypeParser(20, (val: string) => BigInt(val));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 20_000,
  ssl: config.databaseUrl.includes('sslmode=disable')
    ? false
    : { rejectUnauthorized: false },
});

pool.on('error', (err: any) => {
  console.error(JSON.stringify({ level: 'error', msg: 'pg idle client error', err: err.message }));
});

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
    }
    throw err;
  } finally {
    client.release();
  }
}
