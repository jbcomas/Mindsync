// Prepara una base SEPARADA para los tests (mindsync_test) y se niega a correr contra cualquier otra.
// Los tests crean y borran cuentas: nunca deben compartir base con datos reales.
import pg from 'pg';

const HOST = process.env.TEST_DB_HOST ?? 'localhost:54329';
export const TEST_DB = 'mindsync_test';
const url = (user: string, pass: string, db: string) => `postgres://${user}:${pass}@${HOST}/${db}`;

export const testUrls = {
  migrator: url('ms_migrator', 'migrator_dev', TEST_DB),
  app: url('ms_app', 'app_dev', TEST_DB),
  worker: url('ms_worker', 'worker_dev', TEST_DB),
  admin: url('postgres', 'postgres_dev', TEST_DB),
};

export default async function setup() {
  // Fijar el entorno ANTES de cargar el paquete db (su guardia valida las URLs al importarse).
  Object.assign(process.env, {
    DATABASE_URL_MIGRATOR: testUrls.migrator, DATABASE_URL_APP: testUrls.app, DATABASE_URL_WORKER: testUrls.worker, DATABASE_URL_ADMIN: testUrls.admin,
  });
  const { migrate } = await import('../packages/db/src/migrate.ts');
  const sup = new pg.Client({ connectionString: url('postgres', 'postgres_dev', 'postgres') });
  await sup.connect();
  try {
    const exists = await sup.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (!exists.rowCount) await sup.query(`CREATE DATABASE ${TEST_DB} OWNER ms_migrator`);
  } finally { await sup.end(); }

  const adm = new pg.Client({ connectionString: testUrls.admin });
  await adm.connect();
  try {
    await adm.query('CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    await adm.query(`ALTER SCHEMA public OWNER TO ms_migrator; REVOKE ALL ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO ms_app, ms_worker, ms_definer; GRANT CREATE ON SCHEMA public TO ms_definer;`);
  } finally { await adm.end(); }
  await migrate(testUrls.migrator);
}
