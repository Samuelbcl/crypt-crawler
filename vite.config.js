import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2020',
    // Sourcemaps off in prod: ~30% bundle size win and avoids shipping
    // unminified source paths to Steam/web users. Re-enable locally if you
    // need to debug a prod-only issue.
    sourcemap: false,
  },
});
