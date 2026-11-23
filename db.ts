import pg from 'pg';

// DATE columns come back as 'YYYY-MM-DD' strings (never as JS Dates shifted by the server time zone)
pg.types.setTypeParser(1082, (v: string) => v);

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export function makePool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

/** Runs fn inside ONE transaction with the tenant context set, so FORCE ROW LEVEL SECURITY applies to every statement. */
export async function withTenant<T>(pool: Pool, tenantId: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
