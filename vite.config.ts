import { defineConfig } from 'vitest/config';

// PORT lets parallel agents (one per worktree) run their own dev server + e2e without colliding.
const port = Number(process.env.PORT ?? 5173);

export default defineConfig({
  server: { port, strictPort: true, watch: { ignored: ['**/.claude/**', '**/source-map/**'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.claude/**'],
    environment: 'node',
  },
});
