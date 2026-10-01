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
    // 后端默认端口已经让给本机生产实例（52342），开发服务器另起一个，避免互抢。
    port: 52343,
    proxy: {
      '^/api/': 'http://127.0.0.1:52342',
      '/health': 'http://127.0.0.1:52342',
      '/files': 'http://127.0.0.1:52342',
    },
  },
});
