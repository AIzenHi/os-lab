import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1500
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false
  }
} as Parameters<typeof defineConfig>[0]);
