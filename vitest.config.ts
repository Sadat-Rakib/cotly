import { defineConfig } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineConfig({
  test: {
    projects: [
      defineWorkersProject({
        test: {
          name: 'workers',
          include: ['src/engine/**/*.test.ts', 'src/api/**/*.test.ts', 'src/lib/**/*.test.ts'],
          poolOptions: {
            workers: {
              main: './src/index.ts',
              wrangler: { configPath: './wrangler.toml' },
            },
          },
        },
      }),
      {
        test: {
          name: 'node',
          include: ['src/adapters/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
