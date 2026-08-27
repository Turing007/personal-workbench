import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 52342,
    proxy: {
      '^/api/': 'http://127.0.0.1:52341',
      '/health': 'http://127.0.0.1:52341',
      '/files': 'http://127.0.0.1:52341',
    },
  },
});
