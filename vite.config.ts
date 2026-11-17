import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// İstemci Vite ile derlenir; geliştirme sırasında API ve SSE ofis sunucusuna yönlendirilir.
export default defineConfig({
  root: 'src/client',
  // three.js + the office world is one lazy chunk of about 710 kB (avatar code included; the models are
  // static files in public/models), loaded after the UI
  build: {
    outDir: '../../dist/client', emptyOutDir: true, chunkSizeWarningLimit: 760,
    // The avatar preview page is a QA tool: built only with PREVIEW=1 (see kit-3d/CHARACTERS.md).
    rollupOptions: { input: {
      main: fileURLToPath(new URL('./src/client/index.html', import.meta.url)),
      ...(process.env.PREVIEW === '1' ? { preview: fileURLToPath(new URL('./src/client/preview.html', import.meta.url)) } : {}),
    } },
  },
  server: { proxy: { '/api': 'http://127.0.0.1:4317' } },
});
