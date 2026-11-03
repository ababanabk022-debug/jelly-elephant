import { defineConfig } from 'vite';

// The jelly website is a separate project: build only its own entry and do
// not copy the neighbouring garden's public assets.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-jelly',
    rollupOptions: { input: { jellyStudio: 'jelly-elephant.html' } },
  },
});
