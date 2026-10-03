import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Jeden Worker: frontend (Static Assets) + API + Durable Object.
// `vite dev` uruchamia wszystko w workerd, `vite build` przygotowuje wdrożenie dla `wrangler deploy`.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
