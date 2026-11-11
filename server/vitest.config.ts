import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Усі тести працюють з однією тестовою БД — послідовно.
    fileParallelism: false,
    globalSetup: ['test/globalSetup.ts'],
    env: {
      NODE_ENV: 'test',
      UPLOAD_DIR: path.join(os.tmpdir(), 'vudo-test-uploads'),
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://localhost/vudo_erp_test',
    },
  },
});
