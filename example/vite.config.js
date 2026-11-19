import { fileURLToPath } from 'node:url';
export default {
  // EXAMPLE_BASE=/some/path/ pnpm build:example puts the example under that path; by default every URL is relative
  base: process.env.EXAMPLE_BASE ?? './',
  resolve: { dedupe: ['three'] },
  optimizeDeps: { exclude: ['@rsw/mc-java-render-ts', 'nucleation'] },
  server: { fs: { allow: ['..'] } },
  build: { rolldownOptions: { input: {
    studio: fileURLToPath(new URL('./index.html', import.meta.url)),
    minimal: fileURLToPath(new URL('./minimal.html', import.meta.url)),
  } } },
};
