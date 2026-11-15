import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/.work/**'],
    // Functional tests now include durable filesystem writes. Their timeout is not a latency target.
    testTimeout: 15_000,
    maxWorkers: 4,
  },
})
