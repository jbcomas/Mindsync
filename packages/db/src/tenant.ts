import pg from 'pg';

/**
 * ÚNICO camino de acceso a datos de la aplicación (docs/08, C-2).
 * - Abre una transacción y fija app.user_id con set_config(..., is_local = true):
 *   el valor muere al terminar la transacción, así no se filtra a otro request por el pool.
 * - El `pg.Pool` no se exporta: no hay forma de consultar sin pasar por acá.
 */
export type Tx = pg.PoolClient;

export function createTenantDb(connectionString: string, opts: { max?: number } = {}) {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10 });

  async function withTenant<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('userId inválido');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /** Sin identidad: solo para el alta de usuarios (ms_signup) y cosas sin datos de tenant. */
  async function withoutTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  return { withTenant, withoutTenant, close: () => pool.end() };
}
