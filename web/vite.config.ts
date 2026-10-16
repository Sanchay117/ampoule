// SPDX-License-Identifier: Apache-2.0
//
// The compiled contract runs in the browser on `@midnight-ntwrk/compact-runtime`, which loads a
// WebAssembly module. Hence the wasm plugin, an esnext target (the runtime uses top-level await)
// and keeping the onchain runtime out of dependency pre-bundling, which would rewrite its wasm
// imports. The base is relative so the same build works on GitHub Pages under any repo name.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  base: './',
  plugins: [react(), wasm()],
  resolve: {
    // wallet-sdk-address-format decodes Bech32m into Buffers; only the Lace path loads it.
    alias: { buffer: 'buffer/' },
  },
  define: { global: 'globalThis' },
  build: {
    target: 'esnext',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
  optimizeDeps: {
    exclude: ['@midnight-ntwrk/onchain-runtime-v3', '@ampoule/contract', '@ampoule/sdk'],
    esbuildOptions: { target: 'esnext' },
  },
  worker: { format: 'es' },
  server: { fs: { allow: ['..'] }, port: 5199, strictPort: true },
  preview: { port: 5199, strictPort: true },
});
