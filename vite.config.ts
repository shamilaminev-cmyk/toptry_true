import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
build: { sourcemap: true, minify: false }

export default defineConfig(({ mode }) => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          // Backend lives on :5174 in dev. Keep client free of API keys.
          '/api': {
            target: 'http://localhost:5174',
            changeOrigin: true,
          },
          '/media': {
            target: 'http://localhost:5174',
            changeOrigin: true,
          },
        },
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
