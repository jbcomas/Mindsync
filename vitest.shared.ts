import { testUrls } from './test/globalSetup.ts';

/** Variables de entorno de los tests: TODAS apuntan a mindsync_test. */
export const testEnv = {
  DATABASE_URL_MIGRATOR: testUrls.migrator, DATABASE_URL_APP: testUrls.app,
  DATABASE_URL_WORKER: testUrls.worker, DATABASE_URL_ADMIN: testUrls.admin,
};
export const globalSetup = [new URL('./test/globalSetup.ts', import.meta.url).pathname];
