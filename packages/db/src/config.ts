// Defaults solo para desarrollo local (docker-compose). En producción vienen del entorno.
export const urls = {
  migrator: process.env.DATABASE_URL_MIGRATOR ?? 'postgres://ms_migrator:migrator_dev@localhost:54329/mindsync',
  app: process.env.DATABASE_URL_APP ?? 'postgres://ms_app:app_dev@localhost:54329/mindsync',
  worker: process.env.DATABASE_URL_WORKER ?? 'postgres://ms_worker:worker_dev@localhost:54329/mindsync',
  admin: process.env.DATABASE_URL_ADMIN ?? 'postgres://postgres:postgres_dev@localhost:54329/mindsync',
};

/** Guardia: bajo vitest, jamás conectar a una base que no termine en _test (los tests crean y borran cuentas). */
if (process.env.VITEST) {
  for (const [k, u] of Object.entries(urls)) {
    if (!new URL(u).pathname.endsWith('_test')) throw new Error(`Test abortado: ${k} apunta a una base que no es de test (${new URL(u).pathname}).`);
  }
}
