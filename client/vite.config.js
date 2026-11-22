import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies the FastAPI backend so the browser talks to one origin.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { charts: ['recharts'], scanner: ['html5-qrcode'], vendor: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',       // FastAPI: core API
      '/analytics': 'http://localhost:8000', // FastAPI: analytics
    },
  },
});
