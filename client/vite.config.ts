/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve to the TS source, not the compiled CJS dist: Rollup's static
      // named-export analysis can't see through the multi-level __exportStar
      // barrel re-exports that tsc emits for plain `const` values.
      '@pharmaqms/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/setup-tests.ts'],
  },
});
