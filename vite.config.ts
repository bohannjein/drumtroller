import { defineConfig } from 'vitest/config';

// Relative base so the build works on GitHub Pages under /drumtroller/ and anywhere else.
export default defineConfig({
  base: './',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
