import { defineConfig } from 'vitest/config';
import { testEnv, globalSetup } from '../../vitest.shared.ts';

// Los tests usan SIEMPRE la base mindsync_test (ver test/globalSetup.ts), nunca la de desarrollo.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 20000, fileParallelism: false, env: testEnv, globalSetup } });
