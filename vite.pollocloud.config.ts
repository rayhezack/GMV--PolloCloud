import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { remoteD1DevProxy } from './scripts/remote-d1-dev-proxy.mjs';

export default defineConfig(({ mode }) => ({
  root: path.resolve(__dirname, 'client'),
  base: './',
  plugins: [react(), remoteD1DevProxy()],
  define: {
    'process.env': JSON.stringify({
      NODE_ENV: mode === 'production' ? 'production' : 'development',
      CLIENT_BASE_PATH: '',
      BUILD_TOOL: 'vite',
      MIAODA_BUILD_TARGET: 'standalone',
    }),
  },
  css: {
    postcss: path.resolve(__dirname, 'postcss.config.js'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@client': path.resolve(__dirname, 'client'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
}));
