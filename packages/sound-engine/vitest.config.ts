import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.d.ts'],
      thresholds: { statements: 85, branches: 78, functions: 72, lines: 85 },
    },
  },
})
