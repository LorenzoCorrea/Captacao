import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // O front fala com /api e o Vite repassa para o Node — sem CORS no dev.
    // O proxy do http-proxy lida com SSE (text/event-stream) sem config extra.
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
