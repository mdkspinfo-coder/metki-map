import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Относительные пути: сайт работает и на user.github.io/repo/, и на своём домене.
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: {
        main: page('./index.html'),
        moderation: page('./moderation/index.html'),
      },
    },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
