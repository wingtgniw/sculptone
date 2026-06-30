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
      thresholds: { statements: 92, branches: 85, functions: 85, lines: 92 },
    },
  },
})
