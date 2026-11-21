import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.HOLO_API_TARGET || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
