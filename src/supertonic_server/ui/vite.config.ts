import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `base: '/static/'` so the built index.html references its JS/CSS under /static/
// which is where FastAPI mounts the assets directory.
export default defineConfig({
  base: '/static/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: {
    proxy: {
      '/v1': 'http://localhost:8000',
      '/healthz': 'http://localhost:8000',
    },
  },
});
