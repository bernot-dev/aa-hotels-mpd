import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    testTimeout: 20000,
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
});
