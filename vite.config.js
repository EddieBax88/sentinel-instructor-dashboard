import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    middlewareMode: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});