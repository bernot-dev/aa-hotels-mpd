import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  // Like production builds; tests import the debug modules directly
  define: { __AA_MPD_DEBUG__: false },
  test: {
    environment: 'jsdom',
    globals: true,
    testTimeout: 20000,
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
});
