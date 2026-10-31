import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts'],
    // 服务端契约测试 mock 外部依赖，不访问真实网络
    testTimeout: 15_000,
  },
})
