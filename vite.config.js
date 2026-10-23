import { defineConfig } from 'vite';

// En GitHub Pages la app vive en /chess-training/ (BASE_PATH lo pone el flujo de publicación).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
});
