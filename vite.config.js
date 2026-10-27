import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    middlewareMode: true,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});