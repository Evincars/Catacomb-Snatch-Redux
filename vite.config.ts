import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: process.env['VITE_BASE_URL'] ?? '/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    target: 'es2020',
  },
});
