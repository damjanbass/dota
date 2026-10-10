import path from 'node:path';
import { defineConfig } from 'vitest/config';

// PORT lets parallel agents (one per worktree) run their own dev server + e2e without colliding.
const port = Number(process.env.PORT ?? 5173);
const root = process.cwd();

// Ignore only top-level folders next to this config. A glob like '**/.claude/**' would match every file
// when the project itself lives inside .claude/worktrees/<agent>/ and freeze HMR there.
const ignoredWatch = (file: string): boolean => {
  const rel = path.relative(root, file).split(path.sep).join('/');
  return rel.startsWith('.claude/') || rel.startsWith('source-map/');
};

export default defineConfig({
  server: { port, strictPort: true, watch: { ignored: [ignoredWatch] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.claude/**'],
    environment: 'node',
  },
});
